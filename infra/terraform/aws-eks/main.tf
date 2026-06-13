# ── Locals ────────────────────────────────────────────────────────────────────

locals {
  cluster_name = "${var.project_name}-eks"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ── Network — reuse the default VPC ───────────────────────────────────────────
# For production, replace these data sources with a dedicated VPC module
# (private subnets, NAT gateway, separate control-plane vs node subnets).

data "aws_vpc" "default" {
  default = true
}

# us-east-1e (zone ID use1-az3) does not support EKS control plane instances.
# Filtering by available AZs with that zone excluded is the robust fix —
# the zone ID is stable and the exclude is a no-op in regions without that zone.
data "aws_availability_zones" "eks" {
  state            = "available"
  exclude_zone_ids = ["use1-az3"]
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "availabilityZone"
    values = data.aws_availability_zones.eks.names
  }
}

# Tag every default subnet so the AWS Cloud Controller Manager can discover
# them when provisioning LoadBalancer services (type: LoadBalancer in K8s).
resource "aws_ec2_tag" "subnet_elb" {
  for_each    = toset(data.aws_subnets.default.ids)
  resource_id = each.value
  key         = "kubernetes.io/role/elb"
  value       = "1"
}

resource "aws_ec2_tag" "subnet_cluster" {
  for_each    = toset(data.aws_subnets.default.ids)
  resource_id = each.value
  key         = "kubernetes.io/cluster/${local.cluster_name}"
  value       = "shared"
}

# ── IAM — cluster control plane ───────────────────────────────────────────────

resource "aws_iam_role" "cluster" {
  name = "${local.cluster_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "cluster_policy" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

# ── IAM — managed node group ──────────────────────────────────────────────────

resource "aws_iam_role" "nodes" {
  name = "${local.cluster_name}-nodes-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "nodes_worker" {
  role       = aws_iam_role.nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "nodes_cni" {
  role       = aws_iam_role.nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_iam_role_policy_attachment" "nodes_ecr" {
  role       = aws_iam_role.nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# ── EKS Cluster ───────────────────────────────────────────────────────────────

resource "aws_eks_cluster" "this" {
  name     = local.cluster_name
  version  = var.kubernetes_version
  role_arn = aws_iam_role.cluster.arn

  vpc_config {
    subnet_ids              = data.aws_subnets.default.ids
    endpoint_public_access  = true
    endpoint_private_access = true
  }

  # Ship control-plane logs to CloudWatch for audit and troubleshooting.
  enabled_cluster_log_types = ["api", "audit", "authenticator"]

  depends_on = [aws_iam_role_policy_attachment.cluster_policy]

  tags = merge(local.common_tags, { Name = local.cluster_name })
}

# ── EKS Managed Node Group ────────────────────────────────────────────────────

resource "aws_eks_node_group" "app" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "${var.project_name}-app-nodes"
  node_role_arn   = aws_iam_role.nodes.arn
  subnet_ids      = data.aws_subnets.default.ids

  instance_types = [var.node_instance_type]
  capacity_type  = var.capacity_type

  scaling_config {
    desired_size = var.node_desired_size
    min_size     = var.node_min_size
    max_size     = var.node_max_size
  }

  update_config {
    max_unavailable = 1
  }

  labels = {
    role = "app"
  }

  depends_on = [
    aws_iam_role_policy_attachment.nodes_worker,
    aws_iam_role_policy_attachment.nodes_cni,
    aws_iam_role_policy_attachment.nodes_ecr,
  ]

  tags = merge(local.common_tags, { Name = "${var.project_name}-app-nodes" })
}

# ── EKS Managed Addons ────────────────────────────────────────────────────────
# Pinning to recommended versions ensures deterministic upgrades.
# Run: aws eks describe-addon-versions --kubernetes-version <ver> --addon-name <name>
# to find the latest recommended version for your K8s version.

resource "aws_eks_addon" "vpc_cni" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "vpc-cni"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.app]

  tags = local.common_tags
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "kube-proxy"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.app]

  tags = local.common_tags
}

resource "aws_eks_addon" "coredns" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "coredns"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.app]

  tags = local.common_tags
}

resource "aws_eks_addon" "pod_identity" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "eks-pod-identity-agent"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.app]

  tags = local.common_tags
}

# ── OIDC Provider (for IRSA / Pod Identity) ───────────────────────────────────
# Required if you ever want pods to assume IAM roles without node-level creds.
# The db-agent app doesn't need this today, but it's cheap to provision and
# painful to add later.

data "tls_certificate" "eks" {
  url = aws_eks_cluster.this.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.this.identity[0].oidc[0].issuer

  tags = merge(local.common_tags, { Name = "${local.cluster_name}-oidc" })
}
