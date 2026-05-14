import { app } from 'nitron'

app.init({
  name: "My Nitron App",
  packageId: "com.munjez.app",
  version: "1.0.0",
  entry: "index.html",
  orientation: "portrait",
  statusBar: true,
  permissions: ["INTERNET"]
})
