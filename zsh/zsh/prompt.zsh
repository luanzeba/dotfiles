# Prevent % on missing newline
export PROMPT_EOL_MARK=''

autoload -Uz vcs_info
zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:*' check-for-changes true
zstyle ':vcs_info:git*' formats "(%b %m%u%c)"
zstyle ':vcs_info:*' actionformats "(%b %m%c%u %F{cyan}%a%f)"
zstyle ':vcs_info:*' stagedstr "%F{green}S%f"
zstyle ':vcs_info:*' unstagedstr "%F{yellow}U%f"

setopt prompt_subst

# Define a function to shorten directory names, except for the last component
# For example, ~/.config/nvim/foo/bar will be shortened to ~/.c/n/f/bar
function shorten_path {
  # Replace the home directory path with ~
  local input_path="${1/#$HOME/~}"
  echo "$input_path" | awk -F/ '{
    out = "";
    for (i=1; i<NF; i++) {
      # Special handling for directories starting with .
      if (substr($i, 1, 1) == ".") {
        out = out substr($i, 1, 2) "/";
      } else {
        out = out substr($i, 1, 1) "/";
      }
    }
    out = out $NF;
    print out;
  }'
}

function jj_prompt_info {
  command -v jj >/dev/null 2>&1 || return 1
  command jj --ignore-working-copy workspace root >/dev/null 2>&1 || return 1

  command jj --ignore-working-copy --no-pager log --no-graph --limit 1 --revisions @ \
    --template 'change_id.shortest(4) ++ "\x1f" ++ separate(" ", if(conflict, "!", ""), if(empty, "(empty)", ""), if(description == "", "(no description)", "")) ++ "\x1f" ++ description.first_line().substr(0, 40)' 2>/dev/null
}

# Define a precmd function to update the prompt with the shortened path
function precmd {
  local jj_info jj_change_id jj_state jj_description
  if jj_info="$(jj_prompt_info)"; then
    # jj's colocated Git checkout is intentionally detached, so don't show it as Git.
    IFS=$'\x1f' read -r jj_change_id jj_state jj_description <<< "$jj_info"
    jj_change_id=${jj_change_id//\%/%%}
    jj_state=${jj_state//\%/%%}
    jj_description=${jj_description//\%/%%}

    vcs_info_msg_0_="[%F{8}jj%f %F{blue}${jj_change_id}%f"
    [[ -n $jj_state ]] && vcs_info_msg_0_+=" ${jj_state}"
    vcs_info_msg_0_+="]"
    [[ -n $jj_description ]] && vcs_info_msg_0_+=" ${jj_description}"
  else
    vcs_info
  fi
  # Get the current path and shorten it
  local current_path="$PWD"
  local shortened_path="$(shorten_path "$current_path")"

  PROMPT='%F{green}%n%f@%F{magenta}%m%f %F{cyan}'"${shortened_path}"'%f ${vcs_info_msg_0_}
$ '

}

# Register the precmd function as a hook to be executed before each prompt
autoload -Uz add-zsh-hook
add-zsh-hook precmd precmd

