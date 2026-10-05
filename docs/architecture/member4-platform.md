# GigZLK Member 4 Platform Architecture

## Owner

Member 4 — AI/ML + DevOps/Platform Engineering

---

## 1. AI/ML Responsibilities

Member 4 is responsible for the shared AI/ML capabilities of GigZLK:

- Job-worker matching

- Job recommendations

- Fair payment prediction

- Fraud and risk detection

- Review sentiment analysis

- Job quality analysis

- Demand forecasting

- Semantic/vector search

- Optional hiring-likelihood analytics

- Optional worker churn prediction

---

## 2. DevOps / Platform Responsibilities

Member 4 is responsible for shared platform infrastructure:

- Docker

- Docker Compose

- Kubernetes

- GitHub Actions

- Container registry

- Apache Kafka infrastructure

- Redis

- Configuration and secrets

- Prometheus

- Grafana

- Logging

- Security scanning

- Deployment

---

## 3. Architecture Principles

### Independent ML Service

ML functionality will be implemented as an independent service.

Domain services must not contain the ML implementation directly.

### Explainable AI

AI predictions should provide understandable factors where practical.

For example:

Match Score: 94%

Reasons:

- Required skills strongly matched

- Experience requirement satisfied

- Location compatible

- Availability compatible

- Payment expectation compatible

### Data Integrity

Training datasets must not be invented.

Each ML model must document:

- Data source

- Features

- Labels

- Data quality

- Training strategy

- Validation strategy

- Test strategy

- Leakage controls

- Baseline

- Evaluation metrics

- Limitations

### Human Decision Making

ML predictions support users and administrators.

ML predictions should not automatically:

- Ban users

- Reject legitimate applications

- Freeze financial accounts

- Make irreversible decisions

---

## 4. ML API Boundary

Initial ML APIs:

POST /api/v1/ml/match

POST /api/v1/ml/recommend

POST /api/v1/ml/pricing

POST /api/v1/ml/fraud

POST /api/v1/ml/sentiment

Additional APIs may be introduced when justified.

---

## 5. Matching

Matching may consider:

### Job

- Required skills

- Experience

- Category

- Location

- Schedule

- Payment

### Worker

- Skills

- Experience

- Availability

- Location

- Expected payment

- Work history

- Ratings

- Reliability

The system should return an explainable match score.

---

## 6. Recommendations

Potential recommendation features:

- Worker profile

- Skills

- Experience

- Location

- Availability

- Search history

- Applications

- Previous jobs

- Preferences

The recommendation system will begin with a simple baseline and improve progressively.

---

## 7. Fair Payment Estimation

The system may estimate a typical payment range for a job.

Example:

Typical payment range:

Rs. 7,000–9,000

Neutral warning:

"Payment may be below the typical range for similar jobs."

The final payment decision remains with the platform users.

Member 3 owns the actual commission calculation.

---

## 8. Fraud / Risk Detection

Potential fraud signals include:

- Suspicious accounts

- Suspicious jobs

- Payment patterns

- Abnormal behavior

- Reviews

- Messages

- Application patterns

The ML system should return:

- Risk score

- Risk category

- Supporting signals

Fraud predictions should support administrator investigation.

---

## 9. Review Analysis

Review analysis may include:

- Sentiment

- Themes

- Similarity

- Rating anomalies

- Timing anomalies

---

## 10. Demand Forecasting

Demand may be forecast using historical job data.

Possible dimensions:

- Job category

- Time period

- Location

---

## 11. Semantic / Vector Search

Planned architecture:

Worker profiles / Job descriptions

&#x20;           |

&#x20;           v

&#x20;     Text processing

&#x20;           |

&#x20;           v

&#x20;       Embeddings

&#x20;           |

&#x20;           v

&#x20;      Vector Database

&#x20;           |

&#x20;           v

&#x20;   Semantic Similarity

&#x20;           |

&#x20;           v

&#x20;Search / Matching / Recommendation

Domain services should communicate through clean APIs rather than

being tightly coupled to the vector database.

---

## 12. Docker Principles

Containers should:

- Use multi-stage builds where useful

- Use minimal base images

- Run as non-root where practical

- Include health checks

- Use environment-based configuration

- Never contain secrets

- Be reproducible

---

## 13. Kubernetes Principles

Kubernetes will use only components justified by the project:

- Namespace

- Deployments

- Services

- Ingress

- ConfigMaps

- Secrets

- RBAC

- Network Policies

- Resource limits

- Readiness probes

- Liveness probes

- Horizontal Pod Autoscaling where justified

---

## 14. CI/CD

Target pipeline:

Git Push / Pull Request

&#x20;       |

&#x20;       v

Lint

&#x20;       |

&#x20;       v

Unit Tests

&#x20;       |

&#x20;       v

Integration Tests

&#x20;       |

&#x20;       v

Security Scan

&#x20;       |

&#x20;       v

Docker Build

&#x20;       |

&#x20;       v

Container Scan

&#x20;       |

&#x20;       v

Container Registry

&#x20;       |

&#x20;       v

Staging Deployment

---

## 15. Kafka

Member 4 owns Kafka infrastructure and platform configuration.

Application members own their application event logic.

Each event should document:

- Topic

- Producer

- Consumer

- Schema

- Version

- Retry strategy

- Dead-letter strategy where required

---

## 16. Redis

Redis may be used for:

- Caching

- Rate limiting

- Temporary state

- Appropriate distributed locks

Redis must not be used as permanent financial storage.

---

## 17. Monitoring

The platform should monitor:

- API latency

- API errors

- Authentication failures

- Payment failures

- Kafka health

- Database health

- Redis health

- Pod resources

- Pod restarts

- ML inference errors

- Security events

Target observability stack:

Prometheus + Grafana + centralized logging

---

## 18. Security

Security controls include:

- Secrets management

- Kubernetes RBAC

- Network policies

- TLS

- Container scanning

- Dependency scanning

- SAST

- Non-root containers

- Minimal images

- Secure CI/CD

- Audit logging

---

## 19. Current Status

Initial Member 4 platform documentation has been created.

The following will be finalized after Members 1–3 provide their

technology stacks and service architecture:

- Backend integration

- Database integration

- Kafka event contracts

- Authentication integration

- Redis integration

- Docker Compose services

- Kubernetes deployments

- ML API integration

- Service-to-service communication

## Integration planning reference

See the [Unified Architecture](unified-architecture.md) for the latest
cross-member integration proposal and open decision register.

This document describes Member 4's scope. Shared implementation
choices remain proposals until confirmed by their relevant owners.
