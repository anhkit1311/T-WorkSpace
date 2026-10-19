// Q1: HTTP load on the main read paths of the three subsystems (k6, https://k6.io).
//   docker run --rm -i --network host -e BASE=http://localhost:3001 -e TOKEN=<access token> grafana/k6:0.53.0 run - < scripts/benchmarks/k6-api.js
// TOKEN: an access token of a demo account (e.g. from the browser's /auth/refresh response).
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    ramp: { executor: "ramping-vus", stages: [{ duration: "30s", target: 50 }, { duration: "1m", target: 50 }, { duration: "15s", target: 0 }] },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<300"],
  },
};

const BASE = __ENV.BASE || "http://localhost:3001";
const params = { headers: { Authorization: `Bearer ${__ENV.TOKEN}` } };

export default function () {
  for (const path of ["/api/callcenter/me", "/api/elearning/courses", "/api/meetings/schedules", "/api/workspaces"]) {
    const response = http.get(`${BASE}${path}`, params);
    check(response, { [`${path} 200`]: (r) => r.status === 200 });
  }
  sleep(1);
}
