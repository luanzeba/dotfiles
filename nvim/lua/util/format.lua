-- Helper module for formatting only changed/edited lines
local M = {}

---@param bufnr number
---@return boolean
local function has_formatting_client(bufnr)
	for _, client in ipairs(vim.lsp.get_clients({ bufnr = bufnr })) do
		if
			client.supports_method("textDocument/rangeFormatting", { bufnr = bufnr })
			or client.supports_method("textDocument/formatting", { bufnr = bufnr })
		then
			return true
		end
	end
	return false
end

-- Format only changed lines when possible. Falls back to whole-buffer formatting
-- and silently no-ops if there is no attached formatter.
M.format_edited_lines = function()
	local bufnr = vim.api.nvim_get_current_buf()
	if vim.bo[bufnr].buftype ~= "" then
		return
	end

	if not has_formatting_client(bufnr) then
		return
	end

	local start_pos = vim.api.nvim_buf_get_mark(bufnr, "[")
	local end_pos = vim.api.nvim_buf_get_mark(bufnr, "]")
	local has_valid_range = start_pos[1] > 0 and end_pos[1] > 0

	local opts = { bufnr = bufnr }
	if has_valid_range then
		opts.range = {
			start = start_pos,
			["end"] = end_pos,
		}
	end

	pcall(vim.lsp.buf.format, opts)
end

return M
