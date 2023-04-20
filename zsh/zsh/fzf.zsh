export FZF_DEFAULT_COMMAND='rg --files --hidden --glob "!.git/*"'

# Custom key binding for history search with fzf
bindkey -s '^R' "\C-x\C-r"

# Custom widget for fzf history search with current input
fzf-history-widget() {
  local selected_command
  # Deduplicate the history list and use the current input as the initial query for fzf
  # Use tab and shift-tab to navigate through the results
  BUFFER=$(history -n 1 | awk '!seen[$0]++' | fzf --tac +s --tiebreak=index --query="$BUFFER" --height=50% --layout=reverse --preview='echo {}' --preview-window=up:3:wrap --ansi --bind='tab:down,btab:up' )
  CURSOR=$#BUFFER
  zle reset-prompt
}

# Bind the custom widget to a key sequence
zle -N fzf-history-widget
bindkey '^X^R' fzf-history-widget

