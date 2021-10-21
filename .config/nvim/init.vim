let mapleader = ";"
set nocompatible

call plug#begin('~/.config/nvim/plugged')

Plug 'morhetz/gruvbox'
Plug 'jeffkreeftmeijer/vim-dim'
Plug 'tpope/vim-fugitive'
Plug 'preservim/nerdtree'
Plug 'neoclide/coc.nvim'
Plug 'preservim/tagbar'
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'
Plug 'tpope/vim-surround'
Plug 'tpope/vim-commentary'
Plug 'tpope/vim-rhubarb'
Plug 'tpope/vim-unimpaired'
Plug 'dense-analysis/ale'

" Languages support
Plug 'vim-ruby/vim-ruby'
Plug 'tpope/vim-rails'
Plug 'mxw/vim-jsx'
Plug 'pangloss/vim-javascript'
Plug 'rust-lang/rust.vim'

call plug#end()

colorscheme gruvbox

" reload this configuration
nnoremap <leader>sv :source $MYVIMRC<CR>

" NERDTree
map <silent> <C-n> :NERDTreeFind<CR>
map <leader>r :NERDTreeToggle %<CR>

" Fzf
nnoremap <silent> <C-p> :Files<CR>
nnoremap <silent> <C-g> :GFiles<CR>
nnoremap <silent> <C-b> :Buffers<CR>
nnoremap <C-f> :Rg!
" Sort results by proximity https://github.com/jonhoo/proximity-sort
function! s:list_cmd()
  let base = fnamemodify(expand('%'), ':h:.:S')
  return base == '.' ? 'fd -t f' : printf('fd -t f | proximity-sort %s', expand('%'))
endfunction

command! -bang -nargs=? -complete=dir Files
  \ call fzf#vim#files(<q-args>, {'source': s:list_cmd(),
  \                               'options': '--tiebreak=index'}, <bang>0)

" fugitive
nnoremap <Leader>b :execute line(".") . "GBrowse"<CR>
nnoremap <Leader>c :execute line(".") . "GBrowse!"<CR>
nnoremap <Leader>g :G<CR>

" code navigation
nnoremap <leader>] g<C-]>

" ruby & rails
map <leader>t :AV<CR>
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

syntax on
set relativenumber
set number
set background=dark
set smartcase
set undofile
set noerrorbells
set hlsearch
nnoremap <CR> :noh<CR><CR> 

" copy & paste to system clipboard
noremap <Leader>y "*y
noremap <Leader>p "*p

" indentation
set smartindent
filetype plugin indent on
set shiftwidth=2
set breakindent                                      "Maintain indent on wrapping lines
set autoindent                                       "autoindent
set tabstop=2 shiftwidth=2 expandtab softtabstop=2   "tabs = 2 spaces
