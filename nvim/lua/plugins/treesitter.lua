return {
  {
    "nvim-treesitter/nvim-treesitter",
    lazy = false,
    build = ":TSUpdate",
    config = function()
      local ts = require("nvim-treesitter")
      ts.setup({})

      local required_parsers = { "ruby", "zig" }
      local installed = ts.get_installed("parsers")
      local missing = {}

      for _, parser in ipairs(required_parsers) do
        if not vim.tbl_contains(installed, parser) then
          table.insert(missing, parser)
        end
      end

      if #missing > 0 then
        local install = ts.install(missing)
        if install and install.wait then
          -- install() is async; wait here so bootstrap/headless runs don't exit
          -- before parser download/compile finishes.
          install:wait(300000)
        end
      end

      vim.api.nvim_create_autocmd("FileType", {
        pattern = required_parsers,
        callback = function(args)
          vim.treesitter.start(args.buf)
          vim.bo[args.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
        end,
      })
    end,
  },
}
