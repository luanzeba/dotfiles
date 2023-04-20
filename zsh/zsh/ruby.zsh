if [ -d /opt/homebrew/opt ]; then
  source /opt/homebrew/opt/chruby/share/chruby/chruby.sh
  source /opt/homebrew/opt/chruby/share/chruby/auto.sh

  # Read ~/.ruby-version to determine version
  chruby_auto
fi

# if [ ! -z "$ARCH" ]; then
# 	RUBIES=(~/.rubies/$ARCH/*)
# fi

selectgem(){
       if [ -z "$1" ]; then
               bundle show | tr -s ' ' | cut -d ' ' -f 3 | fzy
       else
               echo "$1"
       fi
}

gempath() {
       bundle show $(selectgem $1)
}

tmgem() {
       GEM=$(selectgem "$1")
       tmux new-window -c $(bundle show $GEM) -n "$GEM"
}

gemcd() {
       pushd $(gempath "$1")
}

alias be="bundle exec"
alias bi="bundle install"
alias cop-git="git ls-files -m | xargs ls -1 2>/dev/null | grep "\.rb$" | xargs rubocop"
