return {
  {
    "nvim-treesitter/nvim-treesitter",
    lazy = false,
    build = ":TSUpdate",
    config = function()
      local ts = require("nvim-treesitter")
      ts.setup({})

      local installed = ts.get_installed("parsers")
      if not vim.tbl_contains(installed, "ruby") then
        local install = ts.install({ "ruby" })
        if install and install.wait then
          -- install() is async; wait here so bootstrap/headless runs don't exit
          -- before ruby parser download/compile finishes.
          install:wait(300000)
        end
      end

      vim.api.nvim_create_autocmd("FileType", {
        pattern = { "ruby" },
        callback = function(args)
          vim.treesitter.start(args.buf)
          vim.bo[args.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
        end,
      })
    end,
  },
}
