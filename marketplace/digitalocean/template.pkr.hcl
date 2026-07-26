packer {
  required_plugins {
    digitalocean = {
      version = ">= 1.4.0"
      source  = "github.com/digitalocean/digitalocean"
    }
  }
}

variable "do_token" {
  type      = string
  default   = env("DIGITALOCEAN_API_TOKEN")
  sensitive = true
}

variable "region" {
  type    = string
  default = "nyc3"
}

variable "size" {
  type = string
  # Build on the smallest droplet the listing supports (DO guidance).
  default = "s-1vcpu-1gb"
}

source "digitalocean" "bffless-ce" {
  api_token     = var.do_token
  image         = "ubuntu-24-04-x64"
  region        = var.region
  size          = var.size
  ssh_username  = "root"
  snapshot_name = "bffless-ce-{{timestamp}}"
  tags          = ["bffless", "marketplace"]
}

build {
  sources = ["source.digitalocean.bffless-ce"]

  provisioner "shell" {
    environment_vars = ["DEBIAN_FRONTEND=noninteractive"]
    scripts = [
      "scripts/010-prep.sh",
      "scripts/020-docker.sh",
      "scripts/030-bffless.sh",
      "scripts/900-cleanup.sh",
      "scripts/999-img_check.sh",
    ]
  }
}
