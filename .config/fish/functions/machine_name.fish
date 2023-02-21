function machine_name -d "returns current machine name"
  if test -e ~/.friendly_name
    # codespaces friendly name
    echo -ns ' 💻' (cat ~/.friendly_name)
  else
    echo -ns '@' (hostname)
  end
end

