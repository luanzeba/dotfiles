{
  description = "luan's dotfiles toolchain (Phase 1: node + node-based tools)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        # Single profile bundling Phase 1 tools.
        # Install:  nix profile install ~/dotfiles/nix
        # Upgrade:  nix profile upgrade dotfiles-phase1
        # Remove:   nix profile remove dotfiles-phase1
        packages.default = pkgs.buildEnv {
          name = "dotfiles-phase1";
          paths = with pkgs; [
            # Node runtime (replaces fnm + manual LTS install)
            nodejs_22

            # Node-based dev tools (replace `npm install -g ...`)
            typescript                              # tsc
            typescript-language-server              # tsserver for editors
            prettier
            tree-sitter

            # NOTE: `hunk`/`hunkdiff` is not in nixpkgs, so it stays as an
            # `npm install -g hunkdiff` in hunk/install — but now using the
            # nix-provided npm, so no more fnm/arch shenanigans.
          ];
        };
      });
}
