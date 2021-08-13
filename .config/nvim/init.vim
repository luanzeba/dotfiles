let mapleader = ','
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
Plug 'vim-ruby/vim-ruby'
Plug 'tpope/vim-rails'
Plug 'tpope/vim-surround'
Plug 'tpope/vim-commentary'
Plug 'tpope/vim-rhubarb'
Plug 'dense-analysis/ale'

call plug#end()

colorscheme gruvbox

" NERDTree
map <silent> <C-n> :NERDTreeFind<CR>
map <leader>r :NERDTreeToggle %<CR>

" Fzf
nnoremap <silent> <C-p> :Files<CR>
nnoremap <silent> <C-g> :GFiles<CR>
nnoremap <silent> <C-b> :Buffers<CR>
nnoremap <C-f> :Rg!

" Ruby & Rails
map <leader>t :AV<CR>
autocmd FileType ruby,eruby let g:rubycomplete_buffer_loading = 1                                                                                                     
autocmd FileType ruby,eruby let g:rubycomplete_classes_in_global = 1                                                                                                  
autocmd FileType ruby,eruby let g:rubycomplete_rails = 1
autocmd FileType ruby,eruby set omnifunc=syntaxcomplete#Complete
let g:ale_linters = {'ruby': ['standardrb']}
let g:ale_fixers = {'ruby': ['standardrb']}
let g:ale_fix_on_save = 1
let g:ruby_indent_assignment_style = 'variable'

syntax on
set relativenumber
set number
set background=dark
set smartcase
set hlsearch
set noerrorbells

" indentation
set smartindent
filetype plugin indent on
" On pressing tab, insert 2 spaces
" set expandtab
" show existing tab with 2 spaces width
" set tabstop=2
" set softtabstop=2
" when indenting with '>', use 2 spaces width
" set shiftwidth=2
