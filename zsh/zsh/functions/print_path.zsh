# Prints $PATH in a human-readable format
# Usage: print_path

function print_path() {
  local path="$PATH"

  # Split the PATH variable into an array
  IFS=':' read -r -A path_array <<< "$path"

  # Print each directory in the PATH variable on a new line
  for dir in "${path_array[@]}"; do
    echo "$dir"
  done
}
