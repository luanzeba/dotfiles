-- Silence deprecation warnings
vim.deprecate = function() end

-- Core options
local opt = vim.opt
local g = vim.g

-- Global options
opt.laststatus = 3 -- global statusline
opt.showmode = false

-- Clipboard
opt.clipboard = "unnamedplus"
opt.cursorline = true

-- Indenting
opt.expandtab = true
opt.shiftwidth = 2
opt.smartindent = true
opt.tabstop = 2
opt.softtabstop = 2

-- UI
opt.fillchars = { eob = " " }
opt.ignorecase = true
opt.smartcase = true
opt.mouse = "a"
opt.termguicolors = true -- Enable true color support

-- Numbers
opt.number = true
opt.numberwidth = 2
opt.ruler = false

-- Disable nvim intro but allow dashboard to show
opt.shortmess:append("I")

opt.signcolumn = "yes"
opt.splitbelow = true
opt.splitright = true
opt.timeoutlen = 400
opt.undofile = true

-- Interval for writing swap file to disk
opt.updatetime = 250

-- Go to previous/next line with h,l,left arrow and right arrow
-- when cursor reaches end/beginning of line
opt.whichwrap:append("<>[]hl")

-- Set leader key
g.mapleader = " "

-- Disable some default providers
for _, provider in ipairs({ "node", "perl", "python3", "ruby" }) do
	vim.g["loaded_" .. provider .. "_provider"] = 0
end

-- Add binaries installed by mason.nvim to path
local is_windows = vim.loop.os_uname().sysname == "Windows_NT"
vim.env.PATH = vim.fn.stdpath("data") .. "/mason/bin" .. (is_windows and ";" or ":") .. vim.env.PATH

-- Autocommands
local autocmd = vim.api.nvim_create_autocmd

-- Don't list quickfix buffers
autocmd("FileType", {
	pattern = "qf",
	callback = function()
		vim.opt_local.buflisted = false
	end,
})

-- Autoformat only changed lines on save
vim.cmd([[autocmd BufWritePre * lua require('util.format').format_edited_lines()]])

-- Forward clipboard inside a codespace
if os.getenv("CODESPACES") ~= nil then
	vim.g.clipboard = {
		name = "rdm",
		copy = {
			["+"] = { "rdm", "copy" },
			["*"] = { "rdm", "copy" },
		},
		paste = {
			["+"] = { "rdm", "paste" },
			["*"] = { "rdm", "paste" },
		},
	}
end

-- Load core configuration
require("config.lazy")

-- Load mappings
require("util.mapping").load_all_mappings()

-- Add LazyVim license notice
--[[
Portions of this configuration are derived from LazyVim (https://github.com/LazyVim/LazyVim)
Copyright 2023 LazyVim

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
]]
