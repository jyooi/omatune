# Template. Set version, url, and sha256 on publish.
class Omatune < Formula
  desc "Open-source music sync for iPods"
  homepage "https://github.com/jyooi/omatune"
  version "0.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/jyooi/omatune/releases/download/v0.0.0/omatune-darwin-arm64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
    on_intel do
      url "https://github.com/jyooi/omatune/releases/download/v0.0.0/omatune-darwin-x64"
      sha256 "0000000000000000000000000000000000000000000000000000000000000000"
    end
  end

  def install
    binary = Dir["omatune-*"].first
    odie "Release binary is missing" if binary.nil?
    bin.install binary => "omatune"
  end

  test do
    system bin/"omatune", "devices", "--json"
  end
end
