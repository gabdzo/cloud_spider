# Usage, from labs/cloud-platform:  source scripts/lab-env.sh
# Works on macOS and Linux. The Pulumi passphrase comes from, in order:
#   1. PULUMI_CONFIG_PASSPHRASE already set in the shell
#   2. macOS keychain:   security add-generic-password -a "$USER" -s cloud-platform-pulumi -w
#   3. Linux keyring:    secret-tool store --label=cloud-platform-pulumi service cloud-platform-pulumi
#   4. a file only you can read: ${XDG_CONFIG_HOME:-~/.config}/cloud-platform/pulumi-passphrase (chmod 600)
if [ ! -f "$PWD/scripts/lab-env.sh" ]; then
  echo "source this from labs/cloud-platform" >&2
  return 1
fi

export LAB_REPO_ROOT="$PWD"
export LAB_AWS_PROFILE="${LAB_AWS_PROFILE:-cp-lab}"
export LAB_REGION="${LAB_REGION:-eu-north-1}"
mkdir -p "$LAB_REPO_ROOT/.lab/pulumi-state"
export PULUMI_BACKEND_URL="file://$LAB_REPO_ROOT/.lab/pulumi-state"
export PULUMI_SKIP_UPDATE_CHECK=true

_lab_passphrase() {
  if [ -n "${PULUMI_CONFIG_PASSPHRASE:-}" ]; then printf '%s' "$PULUMI_CONFIG_PASSPHRASE"; return 0; fi
  if command -v security >/dev/null 2>&1 && security find-generic-password -a "$USER" -s cloud-platform-pulumi -w 2>/dev/null; then return 0; fi
  if command -v secret-tool >/dev/null 2>&1 && secret-tool lookup service cloud-platform-pulumi 2>/dev/null; then return 0; fi
  local file="${XDG_CONFIG_HOME:-$HOME/.config}/cloud-platform/pulumi-passphrase"
  if [ -f "$file" ]; then
    case "$(stat -c %a "$file" 2>/dev/null || stat -f %Lp "$file" 2>/dev/null)" in
      600|400) head -n1 "$file" | tr -d '\n'; return 0 ;;
      *) echo "$file must be chmod 600" >&2; return 1 ;;
    esac
  fi
  return 1
}

if ! PULUMI_CONFIG_PASSPHRASE="$(_lab_passphrase)" || [ -z "$PULUMI_CONFIG_PASSPHRASE" ]; then
  unset -f _lab_passphrase
  echo "no Pulumi passphrase: set PULUMI_CONFIG_PASSPHRASE, or use the keychain (macOS), secret-tool (Linux) or ~/.config/cloud-platform/pulumi-passphrase (chmod 600); see platform/aws/BOOTSTRAP.md step 9" >&2
  return 1
fi
unset -f _lab_passphrase
export PULUMI_CONFIG_PASSPHRASE
