local plugins = {
  {
    'tpope/vim-sensible', -- sensible defaults
    lazy = false,
  },
  {
    'tpope/vim-unimpaired', -- pairs of handy bracket mappings
    lazy = false,
  },
  {
    'tpope/vim-repeat', -- enable repeating supported plugin maps with "."
    lazy = false,
  },

  {
    'tpope/vim-fugitive', -- The premier Vim plugin for Git
    lazy = false,
    keys = {
      { "<leader>gg", "<cmd>Git<CR>5j", desc = "Git status" },
      { "<leader>gr", "<cmd>Gread<CR>", desc = "Read file from git" },
    },
  },
  {
    'tpope/vim-rhubarb', -- If fugitive.vim is the Git, rhubarb.vim is the Hub
    lazy = false,
    keys = {
      { "<leader>gb", "<cmd>:execute line('.') . 'GBrowse'<CR>", desc = "Open current line in GitHub" },
    },
  },
  {
    'airblade/vim-gitgutter', -- Helpful git change navigation
    keys = {
      { "]h", "<Plug>(GitGutterNextHunk)", desc = "Go to next hunk" },
      { "[h", "<Plug>(GitGutterPrevHunk)", desc = "Go to previous hunk" },
    }
  },

  {
    'github/copilot.vim',
    lazy = false,
    config = function()
      vim.cmd([[
        imap <silent><script><expr> <C-J> copilot#Accept("\<CR>")
        let g:copilot_no_tab_map = v:true
      ]])
    end,
  },

  {
    'vim-test/vim-test', -- A Vim wrapper for running tests on different granularities.
    keys = {
      { "<leader>tt", "<cmd>TestFile<CR>", desc = "Run all tests in file" },
      { "<leader>tn", "<cmd>TestNearest<CR>", desc = "Run nearest test" },
      { "<leader>ts", "<cmd>TestSuite<CR>", desc = "Run all tests in suite" },
      { "<leader>tl", "<cmd>TestLast<CR>", desc = "Run last test" },
      { "<leader>tf", "<cmd>TestVisit<CR>", desc = "Visit test file" },
    },
    dependencies = {
      'preservim/vimux', -- Easily interact with tmux from vim
    },
    config = function()
      vim.cmd([[let test#strategy = "vimux"]])
    end,
  },

  {
    'bfredl/nvim-miniyank', -- Better clipboard management
    keys = {
      { "p", "<Plug>(miniyank-autoput)", desc = "Paste from miniyank" },
      { "P", "<Plug>(miniyank-autoPut)", desc = "Paste from miniyank previously" },
      { "<leader>n", "<Plug>(miniyank-cycle)", desc = "Cycle through miniyank" },
    },
  },

  {
    'svermeulen/vim-subversive', -- Quick substitution operator
    keys = {
      { "s", "<Plug>(SubversiveSubstitute)", desc = "Substitute" },
      { "ss", "<Plug>(SubversiveSubstituteLine)", desc = "Substitute line" },
      { "S", "<Plug>(SubversiveSubstituteToEndOfLine)", desc = "Substitute to end of line" },
    },
  },

  {
    'alexghergh/nvim-tmux-navigation', -- Seamless navigation between tmux panes and vim splits
    lazy = false,
    opts = {
        disable_when_zoomed = true,
        keybindings = {
            left = '<C-h>',
            down = '<C-j>',
            up = '<C-k>',
            right = '<C-l>',
            last_active = '<C-\\>',
            next = '<C-Space>'
        }
    },
  },

  {
    -- Use Neovim as a language server to inject LSP diagnostics, code actions, and more
    'nvimtools/none-ls.nvim',
    ft = "go",
    config = function()
      return require "custom.configs.null-ls"
    end
  }
}
return plugins
