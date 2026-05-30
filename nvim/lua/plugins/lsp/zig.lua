local nix_zls = vim.fn.expand("~/.nix-profile/bin/zls")

return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        zls = {
          -- zls is installed via the shared nix profile (zig/install + nix/flake.nix).
          -- Mason prepends its own bin dir to PATH, so prefer the nix binary explicitly.
          cmd = vim.uv.fs_stat(nix_zls) and { nix_zls } or { "zls" },
        },
      },
    },
  },
}
