{
  description = "luan's dotfiles toolchain (nix profile: base + node + go + rust + ruby + nvim + helix + jj + gh + git + 1password + whisper + zig + bat tooling)";

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

        # Keep the default package set free-only. Packages that need unfree
        # software must opt in explicitly with their allowed package names.
        pkgsAllowingUnfree = allowedNames: import nixpkgs {
          inherit system;
          config.allowUnfreePredicate = pkg:
            builtins.elem (nixpkgs.lib.getName pkg) allowedNames;
        };
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

        rubyToolchain = pkgs.buildEnv {
          name = "dotfiles-ruby-toolchain";
          paths = with pkgs; [
            ruby_3_4
          ];
        };

        nvimToolchain = pkgs.buildEnv {
          name = "dotfiles-nvim-toolchain";
          paths = with pkgs; [
            neovim
          ];
        };

        helixToolchain = pkgs.buildEnv {
          name = "dotfiles-helix-toolchain";
          paths = with pkgs; [
            helix
          ];
        };

        jjToolchain = pkgs.buildEnv {
          name = "dotfiles-jj-toolchain";
          paths = with pkgs; [
            jujutsu
          ];
        };

        ghToolchain = pkgs.buildEnv {
          name = "dotfiles-gh-toolchain";
          paths = with pkgs; [
            gh
          ];
        };

        gitToolchain = pkgs.buildEnv {
          name = "dotfiles-git-toolchain";
          paths = with pkgs; [
            git
          ];
        };

        onePasswordCli =
          let
            unfreePkgs = pkgsAllowingUnfree [ "1password-cli" ];
          in pkgs.buildEnv {
            name = "dotfiles-1password-cli";
            paths = [
              unfreePkgs._1password-cli
            ];
          };

        whisperToolchain =
          let
            whisper = pkgs.openai-whisper.overridePythonAttrs (old: {
              # The nixpkgs package's audio fixture test currently fails on
              # local Darwin builds even though the CLI and patched ffmpeg
              # runtime work.
              disabledTests = (old.disabledTests or []) ++ [ "test_audio" ];
            });
          in pkgs.buildEnv {
            name = "dotfiles-whisper-toolchain";
            paths = [
              whisper
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
          ruby = rubyToolchain;
          nvim = nvimToolchain;
          helix = helixToolchain;
          jj = jjToolchain;
          gh = ghToolchain;
          git = gitToolchain;
          "1password" = onePasswordCli;
          whisper = whisperToolchain;
          zig = zigToolchain;
          bat = pkgs.bat;

          # Optional core bundle for one-shot installs.
          # Install: nix profile install ~/dotfiles/nix
          # Excludes heavyweight opt-in tools such as Whisper.
          default = pkgs.buildEnv {
            name = "dotfiles-toolchain";
            paths = [ baseTools nodeToolchain goToolchain rustToolchain rubyToolchain nvimToolchain helixToolchain jjToolchain ghToolchain gitToolchain onePasswordCli zigToolchain pkgs.bat ];
          };

          # NOTE: `hunk`/`hunkdiff` is not in nixpkgs, so it stays as an
          # `npm install -g hunkdiff` in hunk/install (using nix-provided npm).
        };
      });
}
