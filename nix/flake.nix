{
  description = "luan's dotfiles toolchain (nix profile: node + zig tooling)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    zig.url = "github:mitchellh/zig-overlay";
  };

  outputs = { nixpkgs, flake-utils, zig, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        # Single profile bundling dotfiles-managed tools.
        # Install:  nix profile install ~/dotfiles/nix
        # Upgrade:  nix profile upgrade nix
        # Remove:   nix profile remove nix
        packages.default = pkgs.buildEnv {
          name = "dotfiles-toolchain";
          paths = with pkgs; [
            # Node runtime (replaces fnm + manual LTS install)
            nodejs_22

            # Node-based dev tools (replace `npm install -g ...`)
            typescript                              # tsc
            typescript-language-server              # tsserver for editors
            prettier
            tree-sitter

            # Zig tooling
            # ziglings tracks Zig dev builds, so use zig-overlay's latest master.
            (zig.packages.${system}.master)
            zls

            # NOTE: `hunk`/`hunkdiff` is not in nixpkgs, so it stays as an
            # `npm install -g hunkdiff` in hunk/install — but now using the
            # nix-provided npm, so no more fnm/arch shenanigans.
          ];
        };
      });
}
