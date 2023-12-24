const { firefox } = require("playwright-extra");
const faker = require("faker");
const inbox = require("inbox");
const { simpleParser } = require("mailparser");
const lockfile = require("proper-lockfile");
const password = require("secure-random-password");
const path = require("path");
const fs = require("fs/promises");

const { amount, headless, catchall, tld, imap } = require("./config.json");

class NikeAccountGen {
  constructor() {
    this.catchall = catchall;
    this.tld = tld;
    this.imap = imap;
  }

  async run() {
    this.first = faker.name.firstName();
    this.last = faker.name.lastName();
    this.password = this.genPw();
    this.mail = `${this.first}${this.last}${this.genNum()}@${this.catchall}`;
    console.log("Creating session...");
    this.browser = await firefox.launch({
      headless,
      ignoreHTTPSErrors: true,
    });
    let context = await this.browser.newContext({
      permissions: ["notifications"],
      javaScriptEnabled: true,
      acceptDownloads: true,
      locale: "en-US",
      timezoneId: "America/New_York",
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      colorScheme: "dark",
      extraHTTPHeaders: {
        "accept-language": "en-US,en;q=0.9",
      },
      viewport: { width: 1536, height: 864 },
      screen: { width: 1536, height: 864 },
    });
    console.log("Injecting scripts...");
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (
        !navigator.webdriver === undefined ||
        !navigator.webdriver === false
      ) {
        Object.defineProperty(navigator, "webdriver", {
          get: () => false,
        });
      }
      window.speechSynthesis.onvoiceschanged = function () {
        window.speechSynthesis.getVoices();
      };
    });
    console.log("Creating account...");
    await page.goto(`https://${this.tld}/register`);
    await page.waitForSelector("#username");
    await page.type("#username", this.mail);
    await page.click('button[aria-label="continue"]');
    let code = await this.listenInbox();
    console.log(`Got code: ${code}`);
    await this.completeSignUp(page, code);
  }

  genNum() {
    return Math.floor(Math.random() * 9999);
  }

  randomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }

  genPw() {
    let pw = password.randomPassword({
      characters: [password.lower, password.upper, password.digits],
    });
    pw = pw.slice(0, pw.length - 5);
    let num = this.randomNumber(1000, 9999);
    pw = pw + "!" + num.toString();
    pw += "Aa";
    return pw;
  }

  async listenInbox() {
    return new Promise((resolve, reject) => {
      let client = inbox.createConnection(false, this.imap.domain, {
        secureConnection: true,
        auth: {
          user: this.imap.user,
          pass: this.imap.password,
        },
      });
      try {
        client.connect();
        client.on("connect", () => {
          console.log("Waiting for code...");
          client.openMailbox("INBOX", async (error, info) => {
            client.on("new", async (message) => {
              if (
                message.from.address === "nike@notifications.nike.com" &&
                message.to.length > 0 &&
                message.to[0].address === this.mail
              ) {
                const messageStream = client.createMessageStream(message.UID);
                let parsed = await simpleParser(messageStream);
                if (parsed.subject === "Here's your one-time code") {
                  const codePattern =
                    /Here's the one-time verification code you requested: (\d+)\./;
                  const code = parsed.text.match(codePattern)[1];
                  client.close();
                  resolve(code);
                }
              }
            });
          });
        });
      } catch (e) {
        console.log(`Error Fetching Code from Inbox: ${e.message}`);
        client.close();
        reject(e);
      }
    });
  }

  async completeSignUp(page, code) {
    await page.type("#l7r-code-input", code.toString());
    await page.type("#l7r-first-name-input", this.first.toString());
    await page.type("#l7r-last-name-input", this.last.toString());
    await page.type("#l7r-password-input", this.password);
    await page.selectOption("#l7r-shopping-preference", "MENS");
    await page.type("#month", this.randomNumber(1, 12).toString());
    await page.type("#day", this.randomNumber(1, 28).toString());
    await page.type("#year", this.randomNumber(1964, 2005).toString());
    await page.click("#privacyTerms");
    await page.click('button[aria-label="Create Account"]');
    await page.waitForSelector("#hf_header_find_a_store");
    console.log("Account created!");
    console.log(`Email: ${this.mail}`);
    console.log(`Password: ${this.password}`);
    await this.writeToFile(
      path.join(__dirname, "./data/exports.txt"),
      `${this.mail}:${this.password}`
    );
    await this.browser.close();
  }

  async pathExists(filePath) {
    try {
      await fs.readFile(filePath);
      return true;
    } catch (e) {
      return false;
    }
  }

  async writeToFile(filePath, content) {
    let release;
    try {
      let fileExists = await this.pathExists(filePath);
      if (!fileExists) {
        await fs.writeFile(filePath, "");
      }
      release = await lockfile.lock(filePath, {
        retries: {
          retries: 100,
          factor: 3,
          minTimeout: 1 * 1000,
          maxTimeout: 60 * 1000,
          randomize: true,
        },
      });
      await fs.appendFile(filePath, `${content}\n`);
      await release();
      release = null;
    } catch (err) {
      console.error(`Error adding to file: ${err.message}`);
    } finally {
      if (release) {
        await release();
      }
    }
  }
}

const run = async () => {
  console.log(`Running ${amount} task(s)...`);
  let tasks = Array.from({ length: amount }, () => new NikeAccountGen());
  let results = (await Promise.allSettled(tasks.map((x) => x.run()))).filter(
    (x) => x.status === "fulfilled"
  );
  console.log(`Tasks Completed ---> [${results.length}/${amount}]`);
};

run();
