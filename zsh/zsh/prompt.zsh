# Prevent % on missing newline
export PROMPT_EOL_MARK=''

autoload -Uz vcs_info
zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:*' check-for-changes true
zstyle ':vcs_info:git*' formats "(%b %m%u%c)"
zstyle ':vcs_info:*' actionformats "(%b %m%c%u %F{cyan}%a%f)"
zstyle ':vcs_info:*' stagedstr "%F{green}S%f"
zstyle ':vcs_info:*' unstagedstr "%F{yellow}U%f"

precmd() {
	vcs_info
}

setopt prompt_subst

# # Define a function to shorten directory names, except for the last component
function shorten_path {
  # Replace the home directory path with ~
  local input_path="${1/#$HOME/~}"
  # Use awk to shorten each directory component
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

# Define a precmd function to update the prompt with the shortened path
function precmd {
  # Get the current path and shorten it
  local current_path="$PWD"
  local shortened_path="$(shorten_path "$current_path")"
  # Update the PROMPT variable to include the shortened path
  PROMPT='%F{green}%n%f@%F{magenta}%m%f %F{cyan}'"${shortened_path}"'%f ${vcs_info_msg_0_}
$ '
}

# Register the precmd function as a hook to be executed before each prompt
autoload -Uz add-zsh-hook
add-zsh-hook precmd precmd

