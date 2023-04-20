function machine_name {
  if [[ -e ~/.friendly_name ]]; then
    # codespaces friendly name
    echo -n ' 💻 ' $(cat ~/.friendly_name)
  else
    echo -n '@' $(hostname)
  fi
}

