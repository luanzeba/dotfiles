local options = {
  ensure_installed = { "lua", "markdown", "markdown_inline", "ruby", "go" },
  highlight = {
    enable = true,
    use_languagetree = true,
  },
  foldmethod = "manual",
  indent = { enable = true },
  matchup = {         -- andymass/vim-matchup
    enable = true,
  },
}

return options
