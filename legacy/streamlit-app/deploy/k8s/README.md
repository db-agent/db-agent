# Kubernetes Deployment

Kubernetes manifests for the Streamlit DB Agent runtime live under `base/`.

GitHub Actions applies these manifests after building and pushing the Docker
image, then updates the Deployment to the commit SHA tag for the current run.

## Layout

- `base/namespace.yaml` creates the `db-agent` namespace.
- `base/deployment.yaml` runs the Streamlit container.
- `base/service.yaml` exposes the app with a LoadBalancer service.

Cloud infrastructure such as managed databases, clusters, and networking belongs
under `infra/terraform/`.
