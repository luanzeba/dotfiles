let mapleader = " "
set nocompatible

set shell=bash

call plug#begin('~/.config/nvim/plugged')

Plug 'morhetz/gruvbox'
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

" Languages support
Plug 'vim-ruby/vim-ruby'
Plug 'tpope/vim-rails'
Plug 'mxw/vim-jsx'
Plug 'pangloss/vim-javascript'
Plug 'rust-lang/rust.vim'
Plug 'fatih/vim-go', { 'do': ':GoUpdateBinaries' }

call plug#end()

colorscheme gruvbox

if has('nvim')
  set inccommand=nosplit
  noremap <C-q> :confirm qall<CR>
end

" quick-save
nmap <leader>w :w<CR>

" reload this configuration
nnoremap <leader>sv :source $MYVIMRC<CR>

" NvimTree
let g:nvim_tree_quit_on_open = 1
let g:nvim_tree_highlight_opened_files = 1
let g:nvim_tree_show_icons = {
    \ 'git': 0,
    \ 'folders': 0,
    \ 'files': 0,
    \ 'folder_arrows': 0,
    \ }
lua << EOS
-- each of these are documented in `:help nvim-tree.OPTION_NAME`

require'nvim-tree'.setup {
  disable_netrw = true,
  open_on_setup = true,
  view = {
    auto_resize = true
  },
  actions = {
    open_file = {
      quit_on_open = true
    }
  }
}
EOS
nnoremap <C-n> :NvimTreeToggle<CR>
nnoremap <leader>r :NvimTreeRefresh<CR>
nnoremap <leader>n :NvimTreeFindFile<CR>

" Fzf
nnoremap <silent> <C-p> :Files<CR>
nnoremap <silent> <C-g> :GFiles<CR>
nnoremap <silent> <C-b> :Buffers<CR>
nnoremap <C-f> :Rg!
nnoremap <expr> <leader>fw ':Rg! '.expand('<cword>').'<CR>'
" Sort results by proximity https://github.com/jonhoo/proximity-sort
" function! s:list_cmd()
"   let base = fnamemodify(expand('%'), ':h:.:S')
"   return base == '.' ? 'fd -t f' : printf('fd -t f | proximity-sort %s', expand('%'))
" endfunction

" command! -bang -nargs=? -complete=dir Files
"   \ call fzf#vim#files(<q-args>, {'source': s:list_cmd(),
"   \                               'options': '--tiebreak=index'}, <bang>0)

" fugitive
nnoremap <Leader>b :execute line(".") . "GBrowse"<CR>
nnoremap <Leader>c :execute line(".") . "GBrowse!"<CR>
nnoremap <Leader>g :G<CR>5j

" code navigation
nnoremap <leader>] g<C-]>              | " Go to definition. If more than one definition, open quick-list
nnoremap <leader>m :TagbarToggle<CR>   | " Open list of tags in TagBar
nnoremap <leader>lb <C-^>              | " Open last buffer

" Switch between the last two files
nnoremap <Leader><Leader> <C-^>

" ruby & rails
map <leader>tt :AV<CR>
autocmd FileType ruby,eruby let g:rubycomplete_buffer_loading = 1
autocmd FileType ruby,eruby let g:rubycomplete_classes_in_global = 1
autocmd FileType ruby,eruby let g:rubycomplete_rails = 1
autocmd FileType ruby,eruby set omnifunc=syntaxcomplete#Complete
let g:ale_linters = {'ruby': ['standardrb'], 'rust': ['analyzer']}
let g:ale_fixers = {'ruby': ['standardrb']}
let g:ale_fix_on_save = 1
let g:ruby_indent_assignment_style = 'variable'

" rust
let g:rustfmt_autosave = 1
let g:rustfmt_emit_files = 1
let g:rustfmt_fail_silently = 0
let g:rust_clip_command = 'xclip -selection clipboard'

" go
let g:go_highlight_structs = 1
let g:go_highlight_methods = 1
let g:go_highlight_functions = 1
let g:go_highlight_operators = 1
let g:go_highlight_build_constraints = 1
let g:go_highlight_extra_types = 1
let g:go_highlight_function_parameters = 1
let g:go_highlight_function_calls = 1
let g:go_highlight_types = 1
let g:go_highlight_fields = 1
let g:go_highlight_variable_declarations = 1
let g:go_highlight_variable_assignments = 1

" copy & paste to system clipboard
noremap <Leader>y "*y
noremap <Leader>p "*p

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

" =============================================================================
" # Editor settings
" =============================================================================
set background=dark             " Default color groups 
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
