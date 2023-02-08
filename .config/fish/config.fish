set -g theme_display_git_default_branch yes
set -g theme_nerd_fonts no

alias vim="nvim"
alias be="bundle exec"
alias berc="bundle exec rails console"
alias bers="bundle exec rails server"
alias bi="bundle install"
alias cop="bundle exec rubocop"
alias cssh="csw ssh -- -R 127.0.0.1:7391:$(rdm socket)"
# alias cop-git="git ls-files -m | xargs ls -1 2>/dev/null | grep "\.rb$" | xargs rubocop"
alias vfish="vim $HOME/.config/fish/config.fish"
alias sfish="source $HOME/.config/fish/config.fish"
alias vvim="vim $HOME/.config/nvim/init.vim"
alias svim="source $HOME/.config/nvim/init.vim"
# alias dkill="killall Docker && cd /Applications;open -a Docker;cd $HOME"
alias k="kubectl"
alias rspec="nocorrect bundle exec rspec" # Do not autocorrect "rspec" command

alias icloud="cd $HOME/Library/Mobile\ Documents/com~apple~CloudDocs/"

export EDITOR="nvim"
export PATH="$PATH:$HOME/bin"

if test $CODESPACES
  export PATH="$PATH:/home/linuxbrew/.linuxbrew/bin"
  if test -d /workspaces/github
    export PATH="$PATH:/workspaces/github/bin"
  end
else
  export PATH="$PATH:$HOME/.cargo/bin"
end

# Map Ctrl-x to clear
bind \cx 'clear; commandline -f repaint'

if status is-interactive
    # Commands to run in interactive sessions can go here
end
