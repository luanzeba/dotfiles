set -g theme_display_git_default_branch yes
set -g theme_nerd_fonts no

alias vim='nvim'
alias be='bundle exec'
alias berc='bundle exec rails console'
alias bers='bundle exec rails server'
alias bi='bundle install'
alias cop='bundle exec rubocop'
# alias cop-git='git ls-files -m | xargs ls -1 2>/dev/null | grep '\.rb$' | xargs rubocop'
alias vfish='vim ~/.config/fish/config.fish'
alias sfish='source ~/.config/fish/config.fish'
alias vvim='vim ~/.config/nvim/init.vim'
# alias dkill='killall Docker && cd /Applications;open -a Docker;cd ~'
alias k='kubectl'
alias rspec='nocorrect bundle exec rspec' # Do not autocorrect 'rspec' command

alias icloud='cd /Users/lvieira/Library/Mobile\ Documents/com~apple~CloudDocs/'

export EDITOR='nvim'

set CHRUBY_ROOT '/opt/homebrew/opt/chruby'
source /opt/homebrew/opt/chruby-fish/share/chruby/chruby.fish
source /opt/homebrew/opt/chruby-fish/share/chruby/auto.fish # Enable auto-switching based on .ruby-version file

export PATH="$HOME/.cargo/bin:$PATH"
# zoxide init fish | source

# convenience function for selecting a branch for checkout
# gbco() {
#   current=$(git branch | grep '\*' | cut -d ' ' -f2)
#   selected=$( (git branch --no-color | grep -v '\*' | xargs -n 1; echo $current ) | fzf -0 -1 --tac -q "${1:-""}" --prompt "$current> ")
#   if [ ! -z "$selected" ]; then
#       git checkout "$selected"
#   fi
# }

if status is-interactive
    # Commands to run in interactive sessions can go here
end
