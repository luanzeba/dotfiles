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
Plug 'tpope/vim-rails'
Plug 'tpope/vim-surround'
Plug 'tpope/vim-commentary'
Plug 'tpope/vim-rhubarb'


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

" Rails
map <leader>t :AV<CR>

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
set expandtab
" show existing tab with 2 spaces width
set tabstop=2
set softtabstop=2
" when indenting with '>', use 2 spaces width
set shiftwidth=2
