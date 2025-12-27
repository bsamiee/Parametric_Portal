# cert-manager Platform Configuration

TLS certificate automation via Let's Encrypt DNS-01 challenges.

## DNS Provider Selection

Choose ONE DNS provider and deploy the corresponding ClusterIssuer:

### Google Cloud DNS (GCP)

**Prerequisites**:
1. GCP project with Cloud DNS API enabled
2. Service account with `dns.admin` role (or custom role with `dns.resourceRecordSets.*`, `dns.changes.*`, `dns.managedZones.list`)
3. Service account key JSON downloaded

**Create Secret**:
```bash
kubectl create secret generic clouddns-sa-secret \
  --namespace=cert-manager \
  --from-file=key.json=/path/to/service-account-key.json
```

**Deploy**: Use `kustomization.yaml` with `clusterissuer-clouddns.yaml`

### Azure DNS

**Prerequisites**:
1. Azure subscription with DNS zone created
2. Managed identity with "DNS Zone Contributor" role
3. Client ID of managed identity

**Deploy**: Use `kustomization.yaml` with `clusterissuer-azuredns.yaml`

## Configuration Steps

1. Choose DNS provider (clouddns or azuredns)
2. Create `kustomization.yaml`:
   ```yaml
   apiVersion: kustomize.config.k8s.io/v1beta1
   kind: Kustomization
   resources:
     - clusterissuer-clouddns.yaml  # OR clusterissuer-azuredns.yaml
   ```
3. Replace placeholders in chosen ClusterIssuer file
4. Create required secrets
5. Deploy via ArgoCD

## Validation

```bash
# Check ClusterIssuer status
kubectl get clusterissuer

# Test certificate
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: test-cert
  namespace: default
spec:
  secretName: test-cert-tls
  issuerRef:
    name: letsencrypt-staging  # Use staging for testing
    kind: ClusterIssuer
  dnsNames:
    - test.example.com
EOF

# Check certificate status
kubectl describe certificate test-cert
kubectl get certificaterequest
```
