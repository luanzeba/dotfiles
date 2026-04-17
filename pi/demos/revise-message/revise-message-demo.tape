Output "./pi/demos/revise-message/revise-message-demo.gif"

Set Shell "bash"
Set FontSize 18
Set Width 1680
Set Height 980
Set Theme "Builtin Dark"
Set TypingSpeed 80ms

Type "cd /Users/luan/dotfiles"
Enter
Type "cp ./pi/demos/revise-message/demo-session.jsonl /tmp/revise-message-demo-session.jsonl"
Enter
Type "pi --no-extensions -e ./pi/extensions/revise-message.ts --session /tmp/revise-message-demo-session.jsonl"
Enter
Sleep 2s

Type "/revise"
Enter
Sleep 1s
Enter
Sleep 800ms
Type "- Added from overlay demo."
Enter
Sleep 700ms
Ctrl+Y
Sleep 1200ms

Type "/revise"
Enter
Sleep 1s
Enter
Sleep 800ms
Type "- Continue flow from edited copy."
Enter
Type "More details from the continue action."
Sleep 700ms
Ctrl+S
Sleep 5s

Ctrl+C
Sleep 500ms
Ctrl+C
