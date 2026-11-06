# Reopen what this Rex pane ran before `rex-restart` restarted the server (see rex/bin/rex-restart).
# rex-restart leaves a pending file per pane. The restored shell's first prompt claims it and runs
# its line as if typed, before any key reaches the line editor, so nothing typed can mangle it.
[[ -n $REX_BLOCK && -f ${XDG_STATE_HOME:-$HOME/.local/state}/rex-restart/pending/${REX_BLOCK}.json ]] || return 0
(( $+commands[rex-restart] )) || return 0

autoload -Uz add-zle-hook-widget
_rex_restart_reopen() {
    add-zle-hook-widget -d line-init _rex_restart_reopen
    local line
    line=$(rex-restart _claim "$REX_BLOCK" 2>/dev/null)
    [[ -n $line ]] || return 0
    BUFFER=" $line" # the leading space keeps it out of history (HIST_IGNORE_SPACE)
    zle accept-line
}
add-zle-hook-widget line-init _rex_restart_reopen
