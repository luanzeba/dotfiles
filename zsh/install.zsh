cd "$( dirname "$0" )"

# fetch the contents of zsh-autosuggestions submodule
git submodule update --init

ln -sfn "$(pwd)/zsh"       "$HOME/.zsh"
ln -sf "$(pwd)/.zlogin"    "$HOME/.zlogin"
ln -sf "$(pwd)/.zlogout"   "$HOME/.zlogout"
ln -sf "$(pwd)/.zprofile"  "$HOME/.zprofile"
ln -sf "$(pwd)/.zshrc"     "$HOME/.zshrc"
