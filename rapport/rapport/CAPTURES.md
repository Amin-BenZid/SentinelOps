# Screenshots checklist

Save each screenshot as **PNG** in `figures/captures/` with **exactly** this name.
Until a file exists, the PDF shows a red box with the expected name, so you can
see at a glance what is still missing. Recompile after adding images.

Tips: browser window ~1440 px wide, zoom 100 %, dark theme unless stated,
crop the browser chrome, use realistic data (run a stress container so there is
an incident: `docker run -d --name stress --cpus 1 alpine sh -c "while :; do :; done"`).

| File | Chapter | What to capture |
|---|---|---|
| cap-01-organigramme.png | Ch. 1 | Barmaj IT org chart (ask your supervisor or draw it) |
| cap-02-login.png | Ch. 4 | Login page |
| cap-04-vue-ensemble-normal.png | Ch. 4 | Overview, everything green |
| cap-05-vue-ensemble-incident.png | Ch. 4 | Overview with the stress incident open |
| cap-06-detail-pourquoi.png | Ch. 4 | Incident drawer, "Why?" tab |
| cap-08-detail-processus.png | Ch. 4 | Incident drawer, process snapshot tab |
| cap-10-courbe-anomalie.png | Ch. 4 | Metric chart showing the expected band and the anomalous point |
| cap-11-regles.png | Ch. 4 | Rules Engine page |
| cap-12-parametres.png | Ch. 4 | Settings page (notifications, quiet hours) - hide the webhook URL |
| cap-13-journaux-conteneur.png | Ch. 4 | Container logs panel with Restart button |
| cap-16-slack-declenchement.png | Ch. 4 | Slack FIRING message |
| cap-18-sen-run.png | Ch. 4 | Terminal: `sen run` up to "SentinelOps is ready" (blur the password) |
| cap-19-sen-status.png | Ch. 4 | Terminal: `sen status` |
| cap-20-ci-vert.png | Ch. 5 | GitHub Actions run, all jobs green |
| cap-21-trivy-rouge.png | Ch. 5 | The old failed run where Trivy blocked the image |
| cap-24-pytest.png | Ch. 5 | Terminal: `python -m pytest -q` (37 passed) |
| cap-25-npm-test.png | Ch. 5 | Terminal: `cd server && npm test` (14 passed) |
| cap-26-docker-ps.png | Ch. 5 | Terminal: `docker ps` with the SentinelOps containers |
| cap-27-instance-cloud.png | Ch. 5 | Cloud console showing the instance (hide account id / public IP if you want) |
| cap-28-pare-feu.png | Ch. 5 | Security group / firewall rules |
| cap-29-dashboard-serveur.png | Ch. 5 | Dashboard of the remote server (through the SSH tunnel) |
| cap-30-curl-401.png | Ch. 5 | Terminal: `curl -i http://localhost:4000/api/alerts` -> 401 |
| cap-31-proxy-403.png | Ch. 5 | Terminal: `docker exec sentinelops-agent python -c "import urllib.request as u; u.urlopen(u.Request('http://docker-proxy-ro:2375/containers/create', method='POST'))"` -> HTTP 403 |

Logos (not screenshots): `figures/logos/logo-ecole.png` and `figures/logos/logo-entreprise.png` for the cover page.
