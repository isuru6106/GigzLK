\# GigZLK AI/ML Architecture



\## 1. Purpose



The GigZLK AI/ML platform provides intelligent capabilities to

support workers, publishers and administrators.



The ML system is designed as an independent service so that the

core business services remain independent from ML implementation

details.



\---



\## 2. ML Service



The planned ML service will expose APIs for:



\- Job-worker matching

\- Job recommendations

\- Fair payment estimation

\- Fraud/risk detection

\- Review sentiment analysis



Initial endpoints:



POST /api/ml/match



POST /api/ml/recommend



POST /api/ml/pricing



POST /api/ml/fraud



POST /api/ml/sentiment



Additional endpoints may be added when justified.



\---



\## 3. Job-Worker Matching



\### Job Features



Potential job features:



\- Skills

\- Experience requirement

\- Job category

\- Location

\- Schedule

\- Payment

\- Job history

\- Job quality indicators



\### Worker Features



Potential worker features:



\- Skills

\- Experience

\- Availability

\- Location

\- Expected payment

\- Previous jobs

\- Ratings

\- Reliability



\### Output



The matching API should return:



\- Match score

\- Matching factors

\- Explanation



Example:



94% Match



Reasons:



\- Required skills strongly matched

\- Experience requirement satisfied

\- Worker availability compatible

\- Location compatible

\- Payment expectation compatible



The score must be explainable and should not be presented as an

absolute guarantee of suitability.



\---



\## 4. Recommendations



Recommendations may use:



\- Worker profile

\- Skills

\- Experience

\- Location

\- Availability

\- Search history

\- Applications

\- Previous jobs

\- Preferences



The system should begin with a simple baseline.



Possible progression:



1\. Rule-based filtering

2\. Content-based recommendation

3\. Hybrid recommendation

4\. More advanced models if sufficient data becomes available



\---



\## 5. Payment Estimation



The pricing model estimates a typical payment range for similar

jobs.



Example:



Typical payment range:

Rs. 7,000–9,000



The platform may display:



"Payment may be below the typical range for similar jobs."



The model provides an estimate only.



Users retain control over the final payment amount.



Commission calculation is owned by Member 3.



\---



\## 6. Fraud / Risk Detection



Fraud detection may consider:



\- Account activity

\- Job creation patterns

\- Applications

\- Payment behavior

\- Reviews

\- Messages

\- Repeated suspicious actions

\- Unusual behavioral patterns



The output should include:



\- Risk score

\- Risk category

\- Supporting signals



Example:



Risk Score: 78%



Risk Category:

HIGH



Supporting signals:



\- Unusual payment activity

\- Multiple suspicious account interactions

\- Abnormal review pattern



The model must not automatically ban a user based only on an ML

prediction.



Administrators should be able to investigate flagged cases.



\---



\## 7. Review Analysis



Review analysis may include:



\### Sentiment



\- Positive

\- Neutral

\- Negative



\### Additional Analysis



\- Review themes

\- Similarity

\- Rating anomalies

\- Review timing anomalies

\- Potential coordinated review behavior



\---



\## 8. Demand Forecasting



Demand forecasting may predict job demand by:



\- Category

\- Location

\- Time period



Potential outputs:



\- Expected demand

\- Demand trend

\- Confidence / uncertainty information



\---



\## 9. Semantic / Vector Search



Semantic search architecture:



Job descriptions

&#x20;       +

Worker profiles

&#x20;       +

Skills

&#x20;       |

&#x20;       v

Text preprocessing

&#x20;       |

&#x20;       v

Embedding generation

&#x20;       |

&#x20;       v

Vector database

&#x20;       |

&#x20;       v

Semantic similarity

&#x20;       |

&#x20;       v

Search / matching / recommendation



The vector database should not become a direct dependency for every

business service.



The ML platform should expose clean APIs around semantic search.



\---



\## 10. Data Strategy



No datasets should be invented.



For every model we must document:



\### Dataset



\- Source

\- Collection method

\- Size

\- Features

\- Labels

\- Missing values

\- Data quality



\### Splitting



Where appropriate:



\- Training set

\- Validation set

\- Test set



\### Leakage Prevention



Training information must not contain information that would only

be available after the prediction point.



\### Baseline



Each ML task should have a simple baseline before introducing a

more complex model.



\### Evaluation



Metrics should match the problem.



Examples:



Matching:



\- Precision

\- Recall

\- F1

\- Ranking metrics



Recommendation:



\- Precision@K

\- Recall@K

\- NDCG@K



Pricing:



\- MAE

\- RMSE

\- Prediction interval coverage where applicable



Fraud:



\- Precision

\- Recall

\- F1

\- PR-AUC



Classification:



\- Accuracy

\- Precision

\- Recall

\- F1



Forecasting:



\- MAE

\- RMSE

\- MAPE where appropriate



\---



\## 11. Explainability



Where possible, predictions should expose useful contributing

factors.



Example:



Match Score: 94%



Skill compatibility: High

Experience compatibility: High

Availability compatibility: Medium

Location compatibility: High

Payment compatibility: High



The exact implementation will depend on the selected model.



\---



\## 12. ML Limitations



Potential limitations include:



\- Limited historical data

\- Cold-start users

\- Dataset bias

\- Incomplete profiles

\- Changing job-market conditions

\- Model drift

\- Incorrect or noisy user-generated data



These limitations must be documented in the final project.



\---



\## 13. ML API Design Principle



Business services should call the ML service through APIs.



Example:



Job Service

&#x20;   |

&#x20;   | POST /api/ml/match

&#x20;   v

ML Service

&#x20;   |

&#x20;   v

Matching Model

&#x20;   |

&#x20;   v

Prediction

&#x20;   |

&#x20;   v

Job Service



ML implementation details should remain inside the ML service.



\---



\## 14. Development Strategy



The ML system will be developed progressively.



Phase 1:

Working baseline



Phase 2:

Data validation and evaluation



Phase 3:

Improved model



Phase 4:

Explainability



Phase 5:

Production API



Phase 6:

Monitoring



Phase 7:

Optimization if justified



Complex models should only be introduced when the available data

and evaluation results justify them.



\---



\## 15. Current Status



ML architecture and responsibilities have been documented.



Model implementation will begin after the team confirms:



\- Backend architecture

\- Database structure

\- Available data

\- API contracts

\- Event contracts

\- Authentication approach

