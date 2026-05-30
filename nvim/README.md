# Neovim (minimal reset)

This is a barebones Neovim config built on top of **lazy.nvim**.

## Principles

- Keep Neovim defaults unless there is a real pain point.
- One plugin per file in `lua/plugins/`.
- One language per file in `lua/plugins/lsp/`.
- Plugin setup and keymaps stay together in the same file.

## Structure

```text
nvim/
  init.lua                    # entrypoint, loads core modules
  install                     # install/update script used by dot
  lazy-lock.json              # locked plugin commits from lazy.nvim
  lua/
    core/
      options.lua             # leader and global editor options
      keymaps.lua             # global keymaps only
      autocmds.lua            # global automations (autocmds)
      lazy.lua                # lazy.nvim bootstrap and setup
    plugins/
      which-key.lua           # which-key setup (helix preset)
      treesitter.lua          # nvim-treesitter (ruby parser only)
      lsp.lua                 # imports files from plugins/lsp/
      lsp/
        core.lua              # base mason + lsp wiring
        ruby.lua              # ruby_lsp server config
        _template.lua.example # template for new languages
```
