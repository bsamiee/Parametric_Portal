```mermaid
---
config:
  layout: elk
  look: neo
  theme: base
  elk: {mergeEdges: true, nodePlacementStrategy: BRANDES_KOEPF, cycleBreakingStrategy: GREEDY_MODEL_ORDER, forceNodeModelOrder: true, considerModelOrder: NODES_AND_EDGES}
  themeVariables: {background: "#282a36", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", primaryColor: "#44475a", primaryTextColor: "#f8f8f2", primaryBorderColor: "#6272a4", lineColor: "#6272a4", archEdgeColor: "#8be9fd", archEdgeArrowColor: "#50fa7b", archEdgeWidth: "2", archGroupBorderColor: "#bd93f9", archGroupBorderWidth: "2"}
---
architecture-beta
    accTitle: Multi-Cloud Microservices Architecture
    accDescr: Production distributed system with edge CDN, service mesh, event streaming, polyglot persistence, serverless functions, and observability stack.
    group edge(logos:cloudflare)[Edge Layer]
    service cdn(logos:cloudflare-workers)[CDN Workers] in edge
    service waf(mdi:shield-lock)[WAF] in edge
    service ddos(mdi:security)[DDoS Protection] in edge
    junction edgeJunction in edge
    group frontend(logos:react)[Frontend Services]
    service spa(logos:react)[React SPA] in frontend
    service ssr(logos:nextdotjs)[Next.js SSR] in frontend
    service mobile(logos:flutter)[Flutter Mobile] in frontend
    service desktop(logos:electron)[Electron Desktop] in frontend
    group gateway(cloud)[API Gateway]
    service kong(logos:kong)[Kong Gateway] in gateway
    service envoy(logos:envoyproxy)[Envoy Proxy] in gateway
    service graphql(logos:graphql)[GraphQL] in gateway
    junction gatewayHub in gateway
    group mesh(logos:kubernetes)[Service Mesh]
    service istio(logos:istio)[Istio Control] in mesh
    service linkerd(simple-icons:linkerd)[Linkerd Proxy] in mesh
    service consul(logos:consul)[Consul Connect] in mesh
    group compute(server)[Compute Services]
    group k8s(logos:kubernetes)[Kubernetes] in compute
    service auth(mdi:account-key)[Auth Service] in k8s
    service catalog(mdi:book-open)[Catalog API] in k8s
    service orders(mdi:cart)[Orders Service] in k8s
    service payment(mdi:credit-card)[Payment] in k8s
    service inventory(mdi:warehouse)[Inventory] in k8s
    service shipping(mdi:truck-delivery)[Shipping] in k8s
    junction k8sHub in k8s
    group lambda(logos:aws-lambda)[Serverless] in compute
    service imgResize(mdi:image-size-select-actual)[Image Resize] in lambda
    service pdfGen(mdi:file-pdf-box)[PDF Generator] in lambda
    service emailWorker(mdi:email-fast)[Email Worker] in lambda
    group async(logos:apache-kafka)[Event Streaming]
    service kafka(logos:apache-kafka)[Kafka] in async
    service pulsar(logos:apache-pulsar)[Pulsar] in async
    service nats(simple-icons:nats-dot-io)[NATS] in async
    service rabbitmq(logos:rabbitmq)[RabbitMQ] in async
    junction asyncJunction in async
    group data(database)[Data Persistence]
    group sql(logos:postgresql)[SQL] in data
    service postgres(logos:postgresql)[PostgreSQL] in sql
    service cockroach(simple-icons:cockroachlabs)[CockroachDB] in sql
    service timescale(simple-icons:timescale)[TimescaleDB] in sql
    group nosql(logos:mongodb)[NoSQL] in data
    service mongo(logos:mongodb)[MongoDB] in nosql
    service cassandra(logos:cassandra)[Cassandra] in nosql
    service dynamo(logos:amazon-dynamodb)[DynamoDB] in nosql
    group cache(logos:redis)[Cache] in data
    service redis(logos:redis)[Redis] in cache
    service memcached(simple-icons:memcached)[Memcached] in cache
    service dragonfly(mdi:database-arrow-right)[DragonflyDB] in cache
    group search(logos:elasticsearch)[Search] in data
    service elastic(logos:elasticsearch)[Elasticsearch] in search
    service opensearch(simple-icons:opensearch)[OpenSearch] in search
    service meilisearch(simple-icons:meilisearch)[Meilisearch] in search
    group obs(mdi:monitor-dashboard)[Observability]
    service prometheus(logos:prometheus)[Prometheus] in obs
    service grafana(logos:grafana)[Grafana] in obs
    service jaeger(simple-icons:jaeger)[Jaeger] in obs
    service loki(simple-icons:grafana)[Loki] in obs
    service tempo(mdi:clock-fast)[Tempo] in obs
    junction obsHub in obs
    group security(mdi:shield-check)[Security]
    service vault(logos:vault)[Vault] in security
    service keycloak(simple-icons:keycloak)[Keycloak] in security
    service cert(mdi:certificate)[Cert Manager] in security
    service scanner(mdi:radar)[Scanner] in security
    group external(internet)[External APIs]
    service stripe(logos:stripe)[Stripe] in external
    service twilio(logos:twilio)[Twilio] in external
    service s3(logos:amazon-s3)[S3] in external
    service cloudinary(simple-icons:cloudinary)[Cloudinary] in external
    cdn:R --> L:waf
    waf:R --> L:ddos
    ddos:R --> L:edgeJunction
    edgeJunction:B --> T:spa
    edgeJunction:B --> T:ssr
    spa:B --> T:kong
    ssr:B --> T:kong
    mobile:B --> T:envoy
    desktop:B --> T:graphql
    kong:R --> L:gatewayHub
    envoy:R --> L:gatewayHub
    graphql:R --> L:gatewayHub
    gatewayHub:B --> T:istio
    istio:B --> T:k8sHub
    linkerd:R --> L:k8sHub
    consul:R --> L:k8sHub
    k8sHub:R --> L:auth
    k8sHub:R --> L:catalog
    k8sHub:R --> L:orders
    k8sHub:B --> T:payment
    k8sHub:B --> T:inventory
    k8sHub:B --> T:shipping
    auth:B --> T:keycloak
    catalog:R --> L:elastic
    orders:B --> T:postgres
    orders:R --> L:asyncJunction
    payment:B --> T:stripe
    inventory:R --> L:cockroach
    shipping:B --> T:twilio
    asyncJunction:L --> R:kafka
    asyncJunction:L --> R:pulsar
    asyncJunction:L --> R:nats
    asyncJunction:L --> R:rabbitmq
    kafka:B --> T:emailWorker
    kafka:R --> L:mongo
    pulsar:B --> T:imgResize
    nats:B --> T:pdfGen
    postgres:R --> L:redis
    mongo:R --> L:memcached
    cassandra:R --> L:dragonfly
    catalog:T --> B:opensearch
    orders:T --> B:meilisearch
    k8sHub:L --> R:obsHub
    gatewayHub:L --> R:prometheus
    asyncJunction:T --> B:jaeger
    obsHub:R --> L:prometheus
    obsHub:R --> L:grafana
    obsHub:R --> L:loki
    obsHub:B --> T:tempo
    vault:B --> T:auth
    cert:B --> T:kong
    scanner:R --> L:k8sHub
    imgResize:B --> T:s3
    emailWorker:B --> T:cloudinary
```
