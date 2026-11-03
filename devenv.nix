{
  pkgs,
  ...
}:

{
  packages = with pkgs; [
    actionlint
    check-jsonschema
    gcc
    gnumake
    nodejs_24
    python3
  ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    npm.enable = true;
  };

  # Keep the workspace dependencies in sync with package-lock.json.
  enterShell = ''
    if [ ! -d node_modules ]; then
      npm ci --no-audit --no-fund
    fi
    npm run build:shared
  '';

  enterTest = ''
    npm run lint
    npm run typecheck
    npm test
  '';

  git-hooks.hooks = {
    trim-trailing-whitespace.enable = true;
    end-of-file-fixer.enable = true;
    check-yaml.enable = true;
    check-added-large-files.enable = true;
    check-case-conflicts.enable = true;
    actionlint.enable = true;
    trufflehog.enable = true;

    biome = {
      enable = true;
      name = "biome";
      entry = "npx --no-install biome check --write";
      language = "system";
      pass_filenames = false;
    };

    typecheck = {
      enable = true;
      name = "typecheck";
      entry = "npm run typecheck";
      language = "system";
      pass_filenames = false;
    };

    check-github-workflows = {
      enable = true;
      package = pkgs.check-jsonschema;
      entry = "${pkgs.check-jsonschema}/bin/check-jsonschema --builtin-schema vendor.github-workflows";
      files = "^\\.github/workflows/[^/]+$";
      types = [ "yaml" ];
    };
  };
}
