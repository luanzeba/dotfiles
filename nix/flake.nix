{
  description = "luan's dotfiles toolchain. Each package is one `dot install <tool>` entry in the Nix profile.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    zig.url = "github:mitchellh/zig-overlay";
    zls.url = "github:zigtools/zls";
    handy.url = "github:cjpais/Handy";
    nixgl.url = "github:nix-community/nixGL";
  };

  outputs = { nixpkgs, zig, zls, handy, nixgl, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
    in {
      packages = nixpkgs.lib.genAttrs systems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            # Free-only, except for packages explicitly allowed here.
            config.allowUnfreePredicate = pkg:
              builtins.elem (nixpkgs.lib.getName pkg) [ "1password-cli" "google-chrome" ];
          };
          bundle = name: paths: pkgs.buildEnv { inherit name paths; };
        in {
          base = bundle "dotfiles-base" (with pkgs; [
            fzf # fzf-lua requires fzf >= 0.36; distro packages can lag behind.
            fd
            ffmpeg
            jq
            eza
            ripgrep
            openssh # ssh, ssh-keygen
            tmux
            poppler-utils # pdftotext
            uv # Python tool installer (used by whisper/install)
          ]);
          # The Node profile refreshes nixpkgs independently of flake.lock.
          node = bundle "dotfiles-node" (with pkgs; [
            nodejs_latest
            corepack # Node 25+ does not bundle Corepack
            typescript
            typescript-language-server
            prettier
            tree-sitter
          ]);
          # Minimal npm runtime for Hunk when the full Node toolchain is absent.
          nodeRuntime = pkgs.nodejs_latest;
          go = bundle "dotfiles-go" (with pkgs; [ go gopls gofumpt goimports-reviser ]);
          rust = bundle "dotfiles-rust" (with pkgs; [ rustc cargo rustfmt clippy rust-analyzer ]);
          ruby = pkgs.ruby_3_4;
          nvim = pkgs.neovim;
          helix = pkgs.helix;
          jj = pkgs.jujutsu;
          gh = pkgs.gh;
          glab = pkgs.glab;
          aws = pkgs.awscli2;
          git = pkgs.git;
          bat = pkgs.bat;
          "1password" = pkgs._1password-cli;

          # Ziglings tracks Zig dev builds: zig master + zls default branch.
          zig = bundle "dotfiles-zig" [
            zig.packages.${system}.master
            zls.packages.${system}.default
          ];
        } // pkgs.lib.optionalAttrs (system == "x86_64-linux") {
          chrome = pkgs.google-chrome.override {
            commandLineArgs = "--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true";
          };
        } // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          # NixGL supplies Mesa to Handy's WebKit process on non-NixOS hosts;
          # wtype is on PATH for direct Wayland text insertion.
          handy = pkgs.runCommand "dotfiles-handy" { nativeBuildInputs = [ pkgs.makeWrapper ]; } ''
            mkdir -p "$out/bin"
            for path in ${handy.packages.${system}.default}/*; do
              [[ "$path" == */bin ]] || ln -s "$path" "$out/"
            done
            makeWrapper ${nixgl.packages.${system}.nixGLIntel}/bin/nixGLIntel "$out/bin/handy" \
              --prefix PATH : "${pkgs.wtype}/bin" \
              --add-flags "${handy.packages.${system}.default}/bin/handy"
          '';
        });
    };
}
