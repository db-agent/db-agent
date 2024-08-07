

## Update the Package
```
apt update -y
apt upgrade -y
```

## Install nvidia drivers

```
sudo apt-get install linux-headers-$(uname -r)
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-archive-keyring.gpg
```
