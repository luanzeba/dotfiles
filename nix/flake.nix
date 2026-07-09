{
  description = "luan's dotfiles toolchain (nix profile: base + node + go + rust + zig + bat tooling)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    zig.url = "github:mitchellh/zig-overlay";
    zls.url = "github:zigtools/zls";
  };

  outputs = { nixpkgs, flake-utils, zig, zls, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      let
        nodeRuntime = pkgs.nodejs_22;

        baseTools = pkgs.buildEnv {
          name = "dotfiles-base-tools";
          paths = with pkgs; [
            # fzf-lua requires fzf >= 0.36; distro packages can lag behind.
            fzf

            # Shared local-machine basics previously installed through
            # Homebrew/pacman by install-local.
            azure-cli
            fd
            ffmpeg
            jq
            eza
            ripgrep
            tmux
            poppler-utils # pdftotext
          ];
        };

        nodeToolchain = pkgs.buildEnv {
          name = "dotfiles-node-toolchain";
          paths = with pkgs; [
            # Node runtime (replaces fnm + manual LTS install)
            nodeRuntime

            # Node-based dev tools (replace `npm install -g ...`)
            typescript                              # tsc
            typescript-language-server              # tsserver for editors
            prettier
            tree-sitter
          ];
        };

        goToolchain = pkgs.buildEnv {
          name = "dotfiles-go-toolchain";
          paths = with pkgs; [
            go
            gopls
            gofumpt
            goimports-reviser
          ];
        };

        rustToolchain = pkgs.buildEnv {
          name = "dotfiles-rust-toolchain";
          paths = with pkgs; [
            rustc
            cargo
            rustfmt
            clippy
            rust-analyzer
          ];
        };

        zigToolchain = pkgs.buildEnv {
          name = "dotfiles-zig-toolchain";
          paths = [
            # ziglings tracks Zig dev builds, so use zig-overlay's latest master.
            (zig.packages.${system}.master)

            # Use zls from zigtools/zls (default branch) so it tracks Zig dev.
            # nixpkgs' tagged zls releases can warn on Zig nightlies.
            (zls.packages.${system}.default)
          ];
        };
      in {
        packages = {
          # Core utilities installed by platform installers.
          base = baseTools;

          # Individual packages used by tool-specific install scripts.
          node = nodeToolchain;
          nodeRuntime = nodeRuntime;
          go = goToolchain;
          rust = rustToolchain;
          zig = zigToolchain;
          bat = pkgs.bat;

          # Optional catch-all bundle for one-shot installs.
          # Install: nix profile install ~/dotfiles/nix
          default = pkgs.buildEnv {
            name = "dotfiles-toolchain";
            paths = [ baseTools nodeToolchain goToolchain rustToolchain zigToolchain pkgs.bat ];
          };

          # NOTE: `hunk`/`hunkdiff` is not in nixpkgs, so it stays as an
          # `npm install -g hunkdiff` in hunk/install (using nix-provided npm).
        };
      });
}
