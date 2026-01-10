#!/bin/bash

set -e

# Check if URL is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <github-repo-url>"
    echo "Example: $0 https://github.com/owner/repo"
    exit 1
fi

REPO_URL="$1"
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Extract owner and repo name from URL
REPO_PATH=$(echo "$REPO_URL" | sed -E 's#.*github\.com[/:]([^/]+/[^/\.]+)(\.git)?.*#\1#')

echo "Cloning repository..."

# Clone the repository
cd "$TEMP_DIR"
gh repo clone "$REPO_PATH" repo -- --bare >/dev/null 2>&1
cd repo

echo ""
echo "Fetching branch information..."

# Get all branches (in bare repo, they're at refs/heads/)
branches=$(git for-each-ref --format='%(refname:short)' refs/heads/)

# Find the default branch (usually main or master)
default_branch=$(gh api "repos/$REPO_PATH" --jq '.default_branch')

echo "Default branch: $default_branch"
echo ""
echo "Branch Tree:"
echo "============"

# Create temp files for storing relationships (compatible with older bash)
PARENT_FILE="$TEMP_DIR/parents.txt"
AHEAD_FILE="$TEMP_DIR/ahead.txt"
BEHIND_FILE="$TEMP_DIR/behind.txt"
CHILDREN_FILE="$TEMP_DIR/children.txt"

touch "$PARENT_FILE" "$AHEAD_FILE" "$BEHIND_FILE" "$CHILDREN_FILE"

# Helper functions to store/retrieve data
set_parent() {
    echo "$1|$2" >> "$PARENT_FILE"
}

get_parent() {
    grep "^$1|" "$PARENT_FILE" 2>/dev/null | cut -d'|' -f2 | head -1
}

set_ahead() {
    echo "$1|$2" >> "$AHEAD_FILE"
}

get_ahead() {
    grep "^$1|" "$AHEAD_FILE" 2>/dev/null | cut -d'|' -f2 | head -1
}

set_behind() {
    echo "$1|$2" >> "$BEHIND_FILE"
}

get_behind() {
    grep "^$1|" "$BEHIND_FILE" 2>/dev/null | cut -d'|' -f2 | head -1
}

add_child() {
    echo "$1|$2" >> "$CHILDREN_FILE"
}

get_children() {
    grep "^$1|" "$CHILDREN_FILE" 2>/dev/null | cut -d'|' -f2
}

# Function to find merge base and commit counts
get_branch_info() {
    local branch1="$1"
    local branch2="$2"
    
    # Get merge base
    merge_base=$(git merge-base "$branch1" "$branch2" 2>/dev/null || echo "")
    
    if [ -z "$merge_base" ]; then
        echo "0 0"
        return
    fi
    
    # Count commits ahead and behind
    ahead=$(git rev-list --count "$merge_base..$branch1" 2>/dev/null || echo "0")
    behind=$(git rev-list --count "$merge_base..$branch2" 2>/dev/null || echo "0")
    
    echo "$ahead $behind"
}

# Function to find the best parent branch for a given branch
find_parent_branch() {
    local target_branch="$1"
    local best_parent=""
    local min_ahead=999999
    
    # First, check if it's the default branch
    if [ "$target_branch" = "$default_branch" ]; then
        echo ""
        return
    fi
    
    # Get the oldest commit date for target branch
    local target_date=$(git log --format=%ct "$target_branch" | tail -1)
    
    # Check default branch and all other branches
    # The best parent is the one with:
    # 1. An older oldest commit (was created before this branch)
    # 2. The fewest commits ahead (closest common ancestor)
    best_parent="$default_branch"
    read ahead behind <<< $(get_branch_info "$target_branch" "$default_branch")
    min_ahead=$ahead
    
    # Check all other branches
    for other_branch in $branches; do
        if [ "$other_branch" = "$target_branch" ] || [ "$other_branch" = "$default_branch" ]; then
            continue
        fi
        
        # Get the oldest commit date for potential parent
        local other_date=$(git log --format=%ct "$other_branch" | tail -1)
        
        # Only consider as parent if it's older (existed before target branch)
        if [ "$other_date" -le "$target_date" ]; then
            read ahead behind <<< $(get_branch_info "$target_branch" "$other_branch")
            
            
            # If this branch is a better parent (fewer commits ahead, meaning closer common ancestor)
            if [ "$ahead" -gt 0 ] && [ "$ahead" -lt "$min_ahead" ]; then
                min_ahead=$ahead
                best_parent="$other_branch"
            fi
        fi
    done
    
    echo "$best_parent"
}

# Build branch relationships iteratively to avoid cycles

# Track which branches have been processed
PROCESSED_FILE="$TEMP_DIR/processed.txt"
touch "$PROCESSED_FILE"

# Start with default branch
echo "$default_branch" >> "$PROCESSED_FILE"

# Keep processing until all branches are assigned
remaining_branches="$branches"
max_iterations=100
iteration=0

while [ -n "$remaining_branches" ] && [ $iteration -lt $max_iterations ]; do
    iteration=$((iteration + 1))
    
    new_remaining=""
    made_progress=false
    
    for branch in $remaining_branches; do
        if [ "$branch" = "$default_branch" ]; then
            continue
        fi
        
        
        # Find best parent from already-processed branches only
        best_parent=""
        min_ahead=999999
        
        # Check processed branches
        while IFS= read -r processed_branch; do
            if [ "$processed_branch" = "$branch" ]; then
                continue
            fi
            
            read ahead behind <<< $(get_branch_info "$branch" "$processed_branch")
            
            
            if [ "$ahead" -gt 0 ] && [ "$ahead" -lt "$min_ahead" ]; then
                min_ahead=$ahead
                best_parent="$processed_branch"
            fi
        done < "$PROCESSED_FILE"
        
        if [ -n "$best_parent" ]; then
            set_parent "$branch" "$best_parent"
            read ahead behind <<< $(get_branch_info "$branch" "$best_parent")
            set_ahead "$branch" "$ahead"
            set_behind "$branch" "$behind"
            add_child "$best_parent" "$branch"
            
            # Mark as processed
            echo "$branch" >> "$PROCESSED_FILE"
            made_progress=true
        else
            # Keep in remaining for next iteration
            new_remaining="$new_remaining $branch"
        fi
    done
    
    remaining_branches="$new_remaining"
    
    # If we didn't make progress, break to avoid infinite loop
    if [ "$made_progress" = "false" ]; then
        break
    fi
done

echo ""

# Function to print tree recursively
print_tree() {
    local branch="$1"
    local prefix="$2"
    local is_last="$3"
    
    
    # Print current branch
    if [ "$branch" = "$default_branch" ] && [ -z "$prefix" ]; then
        echo "● $branch (default)"
    else
        local connector="├─"
        if [ "$is_last" = "true" ]; then
            connector="└─"
        fi
        
        local parent=$(get_parent "$branch")
        local ahead=$(get_ahead "$branch")
        local behind=$(get_behind "$branch")
        
        echo "${prefix}${connector} $branch [↑$ahead ↓$behind from $parent]"
    fi
    
    # Get children and convert to array properly
    local children=$(get_children "$branch")
    
    if [ -n "$children" ]; then
        # Convert to array for bash 3.x compatibility
        local child_array=""
        while IFS= read -r child; do
            child_array="$child_array $child"
        done <<< "$children"
        
        # Trim leading space
        child_array=$(echo "$child_array" | sed 's/^ //')
        
        
        # Count children
        local child_count=$(echo "$child_array" | wc -w)
        local i=0
        
        # Iterate through children
        for child in $child_array; do
            i=$((i + 1))
            local new_prefix=""
            
            if [ "$is_last" = "true" ]; then
                new_prefix="${prefix}   "
            else
                new_prefix="${prefix}│  "
            fi
            
            
            if [ $i -eq $child_count ]; then
                print_tree "$child" "$new_prefix" "true"
            else
                print_tree "$child" "$new_prefix" "false"
            fi
        done
    fi
}

# Start printing from default branch
print_tree "$default_branch" "" "false"

# Print any orphaned branches (branches with no clear parent-child relationship)
echo ""
echo "Summary:"
echo "--------"
echo "Total branches: $(echo "$branches" | wc -w)"
echo ""
echo "Legend:"
echo "  ↑ = commits ahead of parent"
echo "  ↓ = commits behind parent"
