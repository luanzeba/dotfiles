let mapleader = " "
set nocompatible

set shell=bash

call plug#begin('~/.config/nvim/plugged')

Plug 'projekt0n/github-nvim-theme'
Plug 'jeffkreeftmeijer/vim-dim'
Plug 'tpope/vim-fugitive'
Plug 'kyazdani42/nvim-tree.lua'
Plug 'preservim/tagbar'
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'
Plug 'tpope/vim-surround'
Plug 'tpope/vim-commentary'
Plug 'tpope/vim-rhubarb'
Plug 'tpope/vim-unimpaired'
Plug 'tpope/vim-sensible'
Plug 'dense-analysis/ale'
Plug 'github/copilot.vim'
Plug 'dag/vim-fish'
Plug 'christoomey/vim-tmux-navigator'
Plug 'vim-test/vim-test'
Plug 'preservim/vimux'
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'ellisonleao/glow.nvim', {'branch': 'main'}
Plug 'airblade/vim-gitgutter'

" Navigation
Plug 'nvim-lua/plenary.nvim'
Plug 'neovim/nvim-lspconfig'
Plug 'gfanto/fzf-lsp.nvim'
Plug 'nvim-telescope/telescope.nvim'
Plug 'nvim-telescope/telescope-fzf-native.nvim', { 'do': 'make' }
Plug 'chipsenkbeil/distant.nvim'

" Languages support
Plug 'vim-ruby/vim-ruby'
Plug 'tpope/vim-rails'
Plug 'mxw/vim-jsx'
Plug 'pangloss/vim-javascript'
Plug 'rust-lang/rust.vim'

call plug#end()

colorscheme github_light_tritanopia

let g:airline_theme='deus'

if has('nvim')
  set inccommand=nosplit
  noremap <leader>q :confirm qall<CR>
end

" quick-save
nmap <leader>w :w<CR>

" reload this configuration
nnoremap <leader>sv :source $MYVIMRC<CR>

" Telescope
lua << EOS
local telescope = require('telescope')

local actions = require("telescope.actions")
telescope.setup{
  defaults = {
    borderchars = { "─", "│", "─", "│", "┌", "┐", "┘", "└" },
    prompt_prefix = "🔍️ ",
    mappings = {
      -- Esc to close while in insert mode
      i = {
        ["<esc>"] = actions.close,
        ["<C-j>"] = actions.move_selection_next,
        ["<C-k>"] = actions.move_selection_previous,
        ["<C-h>"] = "which_key"
      },
    },
  }
}

-- Disable copilot in Telescope
-- vim.g.copilot_filetypes = vim.g.copilot_filetypes or {}
-- vim.g.copilot_filetypes["TelescopeResults"] = false

local map = vim.api.nvim_set_keymap
map("n", "<C-p>", "<CMD>Telescope find_files<CR>", { noremap = true })
map("n", "<C-f>", "<CMD>Telescope live_grep<CR>", { noremap = true })
map("n", "<C-b>", "<CMD>Telescope buffers<CR>", { noremap = true })
map("n", "<Leader>fw", "<CMD>Telescope grep_string<CR>", { noremap = true })

telescope.load_extension('fzf')
-- telescope.load_extension('githubcoauthors')
EOS

" LSP config
lua << EOS
-- Setup language servers.
local lspconfig = require('lspconfig')
lspconfig.pyright.setup {}
lspconfig.tsserver.setup {}
lspconfig.rust_analyzer.setup {
  -- Server-specific settings. See `:help lspconfig-setup`
  settings = {
    ['rust-analyzer'] = {},
  },
}


-- Global mappings.
-- See `:help vim.diagnostic.*` for documentation on any of the below functions
vim.keymap.set('n', '<Leader>e', vim.diagnostic.open_float)
vim.keymap.set('n', '[d', vim.diagnostic.goto_prev)
vim.keymap.set('n', ']d', vim.diagnostic.goto_next)
vim.keymap.set('n', '<Leader>q', vim.diagnostic.setloclist)

-- Use LspAttach autocommand to only map the following keys
-- after the language server attaches to the current buffer
vim.api.nvim_create_autocmd('LspAttach', {
  group = vim.api.nvim_create_augroup('UserLspConfig', {}),
  callback = function(ev)
    -- Enable completion triggered by <c-x><c-o>
    vim.bo[ev.buf].omnifunc = 'v:lua.vim.lsp.omnifunc'

    -- Buffer local mappings.
    -- See `:help vim.lsp.*` for documentation on any of the below functions
    local opts = { buffer = ev.buf }
    vim.keymap.set('n', 'gD', vim.lsp.buf.declaration, opts)
    vim.keymap.set('n', 'gd', vim.lsp.buf.definition, opts)
    vim.keymap.set('n', 'K', vim.lsp.buf.hover, opts)
    vim.keymap.set('n', 'gi', vim.lsp.buf.implementation, opts)
    vim.keymap.set('n', '<C-k>', vim.lsp.buf.signature_help, opts)
    vim.keymap.set('n', '<Leader>wa', vim.lsp.buf.add_workspace_folder, opts)
    vim.keymap.set('n', '<Leader>wr', vim.lsp.buf.remove_workspace_folder, opts)
    vim.keymap.set('n', '<Leader>wl', function()
      print(vim.inspect(vim.lsp.buf.list_workspace_folders()))
    end, opts)
    vim.keymap.set('n', '<Leader>D', vim.lsp.buf.type_definition, opts)
    vim.keymap.set('n', '<Leader>rn', vim.lsp.buf.rename, opts)
    vim.keymap.set({ 'n', 'v' }, '<Leader>ca', vim.lsp.buf.code_action, opts)
    vim.keymap.set('n', 'gr', vim.lsp.buf.references, opts)
    vim.keymap.set('n', '<Leader>f', function()
      vim.lsp.buf.format { async = true }
    end, opts)
  end,
})
EOS

nmap <leader>r :References<CR>
nmap <leader>d :sp<CR>:Definitions<CR>

" NvimTree
lua << EOS
-- each of these are documented in `:help nvim-tree.OPTION_NAME`

require'nvim-tree'.setup {
  disable_netrw = false,
  actions = {
    open_file = {
      quit_on_open = true
    }
  },
  renderer = {
    highlight_opened_files = "name",
    icons = {
      show = {
        file = false,
        git = false,
        folder = false,
        folder_arrow = false
      }
    }
  }
}
EOS
nnoremap <C-n> :NvimTreeToggle<CR>
nnoremap <leader>n :NvimTreeFindFile<CR>

" Git Gutter
nmap ]h <Plug>(GitGutterNextHunk)
nmap [h <Plug>(GitGutterPrevHunk)

" Distant
lua << EOS
local actions = require('distant.nav.actions')
require('distant').setup {
  -- Any settings defined here are applied to all hosts
  ['*'] = {
    distant = {
      args = '--shutdown-after 60',
      },
    file = {
      mappings = {
        ['-']         = actions.up,
        },
      },
    dir = {
      mappings = {
        ['<Return>']  = actions.edit,
        ['-']         = actions.up,
        ['K']         = actions.mkdir,
        ['N']         = actions.newfile,
        ['R']         = actions.rename,
        ['D']         = actions.remove,
        }
      },
    },
  -- Any settings defined here are applied only to example.com
  ['example.com'] = {
    distant = {
      bin = '/path/to/distant',
      },
    lsp = {
      ['My Rust Project'] = {
        cmd = { '/path/to/rust-analyzer' },
        filetypes = { 'rust' },
        root_dir = '/path/to/project-rs',
        on_attach = function()
        nnoremap('gD', '<CMD>lua vim.lsp.buf.declaration()<CR>')
        nnoremap('gd', '<CMD>lua vim.lsp.buf.definition()<CR>')
        nnoremap('gh', '<CMD>lua vim.lsp.buf.hover()<CR>')
        nnoremap('gi', '<CMD>lua vim.lsp.buf.implementation()<CR>')
        nnoremap('gr', '<CMD>lua vim.lsp.buf.references()<CR>')
        end,
        },
      },
    },
  }
EOS

" Fzf
" CTRL-A CTRL-Q to select all and build quickfix list
function! s:build_quickfix_list(lines)
  call setqflist(map(copy(a:lines), '{ "filename": v:val }'))
  copen
  cc
endfunction

let g:fzf_action = {
  \ 'ctrl-q': function('s:build_quickfix_list'),
  \ 'ctrl-t': 'tab split',
  \ 'ctrl-x': 'split',
  \ 'ctrl-v': 'vsplit' }

let $FZF_DEFAULT_OPTS = '--bind ctrl-a:select-all'


" fugitive
nnoremap <Leader>b :execute line(".") . "GBrowse"<CR>
nnoremap <Leader>c :execute line(".") . "GBrowse!"<CR>
nnoremap <Leader>g :G<CR>5j

" code navigation
nnoremap <leader>] g<C-]>              | " Go to definition. If more than one definition, open quick-list
nnoremap <leader>m :TagbarToggle<CR>   | " Open list of tags in TagBar
nnoremap ;; <C-^>                      | " Open last buffer

command! JSONPretty :%!jq '.'          | " auto-format JSON

" ruby & rails
map <leader>tt :AV<CR>
autocmd FileType ruby,eruby let g:rubycomplete_buffer_loading = 1
autocmd FileType ruby,eruby let g:rubycomplete_classes_in_global = 1
autocmd FileType ruby,eruby let g:rubycomplete_rails = 1
autocmd FileType ruby,eruby set omnifunc=syntaxcomplete#Complete
let g:ale_linters = {'ruby': ['rubocop'], 'rust': ['analyzer']}
let g:ale_fixers = {'ruby': ['rubocop']}
let g:ale_fix_on_save = 1
let g:ruby_indent_assignment_style = 'variable'

" rust
let g:rustfmt_autosave = 1
let g:rustfmt_emit_files = 1
let g:rustfmt_fail_silently = 0
let g:rust_clip_command = 'xclip -selection clipboard'

" go
lua << EOS
  local lspconfig = require("lspconfig")
  lspconfig.gopls.setup({
    settings = {
      gopls = {
        analyses = {
          unusedparams = true,
        },
        usePlaceholders = true,
        staticcheck = true,
      },
    },
  })
EOS
lua <<EOF
  -- autoformat on save
  vim.cmd [[autocmd BufWritePre * lua vim.lsp.buf.format()]]
EOF

" copy & paste to system clipboard
noremap <Leader>y "*y
noremap <Leader>p "*p

" copy rails test string to clipboard
" temporary solution until I fix vim-test
function! CopyRailsTestCommand() abort
  let l:command = 'clear; bin/rails test ' . expand("%")
  :call system('pbcopy', l:command)
endfunction

command! CopyFilename :call system('pbcopy', expand("%"))
noremap <Leader>fn :call CopyRailsTestCommand()<CR>

" Forward clipboard in a codespace
if !empty($CODESPACES)
  let g:clipboard = {"name": "rdm", "copy": {}, "paste": {}}
  let g:clipboard.copy["+"] = ["rdm", "copy"]
  let g:clipboard.paste["+"] = ["rdm", "paste"]
  let g:clipboard.copy["*"] = ["rdm", "copy"]
  let g:clipboard.paste["*"] = ["rdm", "paste"]
endif

" vim-test mappings
nmap <silent> <leader>s :TestNearest<CR>  | " Runs the test nearest to the cursor
nmap <silent> <leader>t :TestFile<CR>     | " Runs all tests in the current file
nmap <silent> <leader>a :TestSuite<CR>    | " Runs the whole test suite
nmap <silent> <leader>l :TestLast<CR>     | " Runs the last test
nmap <silent> <leader>gt :TestVisit<CR>   | " Visits the test file from which you last run your tests

" Use vimux for running tests
let test#strategy = "vimux"

" Send test to Codespace ssh session
" function! CodespaceTransform(cmd) abort
"   let codespace = join(readfile(glob('~/.codespace')), "\n")
"   return 'gh cs ssh -c ' . codespace . ' -- ' . a:cmd
" endfunction

" let g:test#custom_transformations = {'codespace': function('CodespaceTransform')}
" let g:test#transformation = 'codespace'

" =============================================================================
" # Editor settings
" =============================================================================
set noerrorbells                " Obvious
set signcolumn=yes              " Always draw sign column. Prevent buffer moving when adding/deleting sign.
set autoindent                  " Copy indent from previous line
set backupcopy=yes              " Keeps original creator code
set backspace=indent,eol,start  " Adds intuitive backspacing
set fillchars+=vert:│           " Use tall pipe in split separators
set cursorline                  " highlight current line
set guicursor=i:ver25-iCursor   " Use | cursor when in insert mode
set history=100                 " Keep 100 lines of command line history
set laststatus=2                " Always show statusline
set lazyredraw                  " Boosts performance at times
set list                        " Don't show listchars
set listchars=tab:»·,trail:·    " Show trailing spaces as dots
set matchtime=0                 " Fix neovim match lag
set nobackup                    " No Backup files
set hidden                      " hide unsaved buffers
set number                      " Show regular numbers
set nofoldenable                " Disable folds
set noshowcmd                   " Don't show command in the last line of the screen
set noswapfile                  " No swap
set nowrap                      " Don't wrap lines
set relativenumber              " Show relative line numbers
set ruler                       " Show the ruler
set scrolloff=10                " Always keep current line in center
set completeopt+=menuone        " Always show menu
set completeopt+=noselect       " Don't select only option
set shortmess=fmnrWIcF          " Customize what vim yells at you
set showmatch                   " Highlight matching paren/brace/bracket
set smarttab                    " Prevents tab/space issues
set synmaxcol=180               " Prevents segfaults and slow rendering
set splitbelow                  " Open hsplits below rather than above
set splitright                  " Open vsplits to the right rather than left
set tags^=.git/tags             " where to find tags
set termguicolors               " 256 colors!
set undolevels=500              " More undo
set wildignorecase              " Case insensitive completions
set wildmenu                    " Enhanced command-line completion

" Proper search
set hlsearch                    " Highlights search
set ignorecase                  " Ignore case in searches
set incsearch                   " Searches for text as entered
set smartcase                   " Enable case sensetive search only when uppsercase characters present
set gdefault                    " Substitute flag is on by default

" indentation
set smartindent                 " Auto insert extra indent level in certain cases
set tabstop=2 shiftwidth=2 expandtab softtabstop=2   "tabs = 2 spaces

" Formatting settings
set expandtab                   " Make spaces not tabs
set shiftwidth=2                " 2 spaces when indented

syntax on
filetype indent on              " Filetype specific indent
filetype plugin on              " Filetype specific plugins

" Enable mouse
if has('mouse')
  set mouse=a
endif

" Use undo file for awesome undo
if exists("+undofile")
  if isdirectory($HOME . '/.config/nvim/undo') == 0
    :silent !mkdir -p ~/.config/nvim/undo > /dev/null 2>&1
  endif

  set undofile
  set undodir=~/.config/nvim/undo/
endif

" Better diffing
if &diff && has("patch-8.1.0360")
  set diffopt+=internal,algorithm:patience,vertical
endif

" Wrapping options
set formatoptions=tc " wrap text and comments using textwidth
set formatoptions+=r " continue comments when pressing ENTER in I mode
set formatoptions+=q " enable formatting of comments with gq
set formatoptions+=n " detect lists for formatting
set formatoptions+=b " auto-wrap in insert mode, and do not wrap old long lines

" Search results centered please
nnoremap <silent> n nzz
nnoremap <silent> N Nzz
nnoremap <silent> * *zz
nnoremap <silent> # #zz
nnoremap <silent> g* g*zz

" Very magic by default
nnoremap ? ?\v
nnoremap / /\v
cnoremap %s/ %sm/

let g:sneak#s_next = 1
let g:vim_markdown_new_list_item_indent = 0
let g:vim_markdown_auto_insert_bullets = 0
let g:vim_markdown_frontmatter = 1

" Clear highlight
map <leader>h :noh<CR>

" Automatically rebalance windows on vim resize
" Critical for working with tmux
autocmd VimResized * :wincmd =

" zoom a vim pane, <C-w>= to re-balance
nnoremap <leader>z :wincmd _<cr>:wincmd \|<cr>
nnoremap <leader>= :wincmd =<cr>
