let mapleader = ";"
set nocompatible

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

" Languages support
Plug 'vim-ruby/vim-ruby'
Plug 'tpope/vim-rails'
Plug 'mxw/vim-jsx'
Plug 'pangloss/vim-javascript'
Plug 'rust-lang/rust.vim'

call plug#end()

colorscheme gruvbox

if has('nvim')
    set guicursor=n-v-c:block-Cursor/lCursor-blinkon0,i-ci:ver25-Cursor/lCursor,r-cr:hor20-Cursor/lCursor
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
set termguicolors
lua require'nvim-tree'.setup {}
map <silent> <C-n> :NvimTreeFindFile<CR>
map <leader>n :NvimTreeToggle<CR>

" Fzf
nnoremap <silent> <C-p> :Files<CR>
nnoremap <silent> <C-b> :Buffers<CR>
nnoremap <C-f> :Rg!
nnoremap <expr> <C-g> ':Rg! '.expand('<cword>').'<CR>'
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
nnoremap <Leader>g :G<CR>5j

" code navigation
nnoremap <leader>] g<C-]>| " go to definition. If more than one definition, open quick-list
nnoremap <leader>m :TagbarToggle<CR>| " Open list of tags in TagBar

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

" copy & paste to system clipboard
noremap <Leader>y "*y
noremap <Leader>p "*p

" =============================================================================
" # Editor settings
" =============================================================================
syntax on
set relativenumber
set number
set background=dark
set undofile
set noerrorbells
set noshowmode
set hidden
set nowrap
set nojoinspaces
let g:sneak#s_next = 1
let g:vim_markdown_new_list_item_indent = 0
let g:vim_markdown_auto_insert_bullets = 0
let g:vim_markdown_frontmatter = 1
" Always draw sign column. Prevent buffer moving when adding/deleting sign.
set signcolumn=yes

" indentation
set smartindent
set tabstop=2 shiftwidth=2 expandtab softtabstop=2   "tabs = 2 spaces

" Wrapping options
set formatoptions=tc " wrap text and comments using textwidth
set formatoptions+=r " continue comments when pressing ENTER in I mode
set formatoptions+=q " enable formatting of comments with gq
set formatoptions+=n " detect lists for formatting
set formatoptions+=b " auto-wrap in insert mode, and do not wrap old long lines

" Proper search
set ignorecase
set smartcase
set gdefault
set hlsearch

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

