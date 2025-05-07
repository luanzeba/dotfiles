---@class conform.FormatterConfigOverride
---@field command? string
---@field args? string[]
---@field stdin? boolean
---@field cwd? string
---@field env? table<string, string>
---@field condition? fun(ctx: conform.Context): boolean
---@field options? table<string, any>

---@class conform.Context
---@field filename string
---@field bufnr number
---@field filetype string
---@field content string[]
---@field range conform.Range

---@class conform.Range
---@field start_line number
---@field start_col number
---@field end_line number
---@field end_col number

---@class conform.setupOpts
---@field format_on_save? boolean
---@field format_after_save? boolean
---@field format? table
---@field default_format_opts? table
---@field formatters_by_ft? table<string, string[]>
---@field formatters? table<string, conform.FormatterConfigOverride|fun(bufnr: number): nil|conform.FormatterConfigOverride>

local M = {}

---@param opts conform.setupOpts
function M.setup(_, opts)
  -- Remove deprecated options
  for _, key in ipairs({ "format_on_save", "format_after_save" }) do
    if opts[key] then
      vim.notify(
        string.format("Don't set `opts.%s` for `conform.nvim`. Use `format_on_save` in the plugin config instead.", key),
        vim.log.levels.WARN
      )
      opts[key] = nil
    end
  end

  if opts.format then
    vim.notify(
      "**conform.nvim** `opts.format` is deprecated. Please use `opts.default_format_opts` instead.",
      vim.log.levels.WARN
    )
  end

  -- Setup format on save
  local format_augroup = vim.api.nvim_create_augroup("Format", { clear = true })
  vim.api.nvim_create_autocmd("BufWritePre", {
    group = format_augroup,
    callback = function(args)
      require("conform").format({ bufnr = args.buf })
    end,
  })

  require("conform").setup(opts)
end

return {
  {
    "stevearc/conform.nvim",
    dependencies = { "mason.nvim" },
    event = "BufReadPost",
    cmd = "ConformInfo",
    keys = {
      {
        "<leader>cF",
        function()
          require("conform").format({ formatters = { "injected" }, timeout_ms = 3000 })
        end,
        mode = { "n", "v" },
        desc = "Format Injected Langs",
      },
    },
    opts = function()
      ---@type conform.setupOpts
      local opts = {
        default_format_opts = {
          timeout_ms = 3000,
          async = false, -- not recommended to change
          quiet = false, -- not recommended to change
          lsp_format = "fallback", -- not recommended to change
        },
        formatters_by_ft = {
          lua = { "stylua" },
          fish = { "fish_indent" },
          sh = { "shfmt" },
          ruby = { "rubocop" },
          go = { "gofmt" },
          rust = { "rustfmt" },
          javascript = { "prettier" },
          typescript = { "prettier" },
          typescriptreact = { "prettier" },
          json = { "prettier" },
        },
        -- The options you set here will be merged with the builtin formatters.
        -- You can also define any custom formatters here.
        ---@type table<string, conform.FormatterConfigOverride|fun(bufnr: integer): nil|conform.FormatterConfigOverride>
        formatters = {
          injected = { options = { ignore_errors = true } },
          -- # Example of using dprint only when a dprint.json file is present
          -- dprint = {
          --   condition = function(ctx)
          --     return vim.fs.find({ "dprint.json" }, { path = ctx.filename, upward = true })[1]
          --   end,
          -- },
          --
          -- # Example of using shfmt with extra args
          -- shfmt = {
          --   prepend_args = { "-i", "2", "-ci" },
          -- },
        },
      }
      return opts
    end,
    config = M.setup,
  },
}