// Browser regression with an IN-MEMORY receipt ledger, not PostgreSQL evidence.
// No external request is permitted. HTML may be supplied on stdin for BASE proof.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.SIRIUS_TEST_PLAYWRIGHT);
const html=process.argv.includes('--stdin')?fs.readFileSync(0,'utf8'):fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const origin='https://4site.sirius27.dpdns.org';
const reproduce=process.argv.includes('--reproduce');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.SIRIUS_TEST_BROWSER,headless:true});
  const results=[];
  try {
    for(const width of [1440,390]) for(const kind of ['cost_estimate','quick_report','consultation','service_request'])
    for(const scenario of ['lost','lost401','lost403','lost429','initial422','initial409','invalid202','explicit_edit']) {
      if(reproduce && (width!==1440 || kind!=='cost_estimate' || scenario!=='lost401')) continue;
      const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
      const name=`${kind}/${width}/${scenario}`;
      try {
        const page=await context.newPage(), calls=[], ledger=new Map(); let routeError;
        page.setDefaultTimeout(10000);
        await context.route('**/*',async route=>{
          try {
            const req=route.request();
            if(req.url()===origin+'/' && req.method()==='GET') return route.fulfill({contentType:'text/html',body:html});
            if(req.url()!==origin+'/api/leads' || req.method()!=='POST') return route.abort();
            const raw=req.postData(),body=JSON.parse(raw),key=req.headers()['idempotency-key'];
            assert.equal(body.client_request_id,key); calls.push({raw,key,submitted:body.submitted_at});
            const count=calls.length;
            // Simulated edge/middleware refusal: NOT backend replay admission.
            if(count===1 && ['initial422','initial409'].includes(scenario))
              return route.fulfill({status:scenario==='initial422'?422:409,contentType:'application/json',body:'{}'});
            if(count===2 && (scenario.startsWith('lost')&&scenario!=='lost' || scenario==='explicit_edit'))
              return route.fulfill({status:scenario==='explicit_edit'?401:Number(scenario.slice(4)),contentType:'application/json',body:'{}'});
            if(ledger.has(key)) assert.equal(ledger.get(key).raw,raw);
            else ledger.set(key,{raw,number:String(482731+ledger.size)});
            const receipt={accepted:true,ok:true,status:'accepted',client_request_id:key,
              request_id:'SR-0123456789ABCDEF',public_request_number:ledger.get(key).number,duplicate:count>1};
            if(count===1 && (scenario.startsWith('lost')||scenario==='explicit_edit')) return route.abort('failed');
            if(count===1 && scenario==='invalid202') receipt.client_request_id='wrong-receipt-key';
            return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify(receipt)});
          } catch(error) {routeError=error; await route.abort();}
        });
        await page.goto(origin+'/');
        // Deterministic interaction only; the shipped page/styles are unchanged.
        await page.addStyleTag({content:'html {scroll-behavior:auto!important} *,*::before,*::after {animation:none!important;transition:none!important}'});
        const form=page.locator(`[data-form-kind="${kind}"]`);
        if(kind==='service_request') {
          await page.locator('.service-request[data-service-code="engineering_analysis"]').click();
          await page.locator('#modal-goal').selectOption({index:1});
          await page.locator('#modal-scope').fill('Synthetic scope');
        } else if(kind!=='quick_report') await form.locator('[name="service_code"]').selectOption('express_audit');
        await form.locator('[name="name"]').fill('SYNTHETIC');
        await form.locator('[name="email"]').fill('synthetic@example.invalid');
        await form.locator('[name="volume"]').fill('10 synthetic sheets');
        await form.locator('[name="message"]').fill('Synthetic retry test');
        await form.locator('[name="consent"]').check();
        const submit=form.locator('button[type="submit"]'),edit=form.getByRole('button',{name:'Изменить данные'});
        async function send() {
          const previous=calls.length;
          await submit.click();
          await page.waitForFunction(([kind,n])=>{
            const f=document.querySelector(`[data-form-kind="${kind}"]`);
            return !f.querySelector('button[type="submit"]').disabled && f.querySelector('.form-status').textContent!=='Отправляем заявку…';
          },[kind,previous],{timeout:2500});
          assert.equal(calls.length,previous+1);
          if(routeError) throw routeError;
        }
        await send();
        if(scenario==='initial422') {
          assert.equal(await form.locator('[name="name"]').isEnabled(),true);
          assert.equal(await edit.isVisible(),false);
          assert.equal(ledger.size,0);
          await send(); assert.notEqual(calls[0].key,calls[1].key);
        } else {
          assert.equal(await submit.textContent(),'Повторить');
          assert.equal(await edit.isVisible(),true);
          await send();
          if(scenario.startsWith('lost')&&scenario!=='lost' || scenario==='explicit_edit') {
            if(reproduce) {
              await send();
              assert.notEqual(calls[0].key,calls[2].key);
              assert.equal(ledger.size,2);
              results.push({name,status:'REPRODUCED',sameFirstRetryKey:calls[0].key===calls[1].key,
                silentNewKey:calls[0].key!==calls[2].key,syntheticLedgerReceipts:ledger.size});
              continue;
            }
            assert.equal(await submit.textContent(),'Повторить','ambiguous request must survive intermediate 4xx');
            assert.equal(await form.locator('[name="name"]').isDisabled(),true);
            assert.equal(await edit.isVisible(),true);
            if(scenario==='explicit_edit') {
              page.once('dialog',d=>{assert.match(d.message(),/могла быть принята/); d.dismiss();});
              await edit.click(); assert.equal(await form.locator('[name="name"]').isDisabled(),true);
              page.once('dialog',d=>d.accept()); await edit.click();
              assert.equal(await form.locator('[name="name"]').isEnabled(),true);
              assert.equal(await form.locator('[name="name"]').evaluate(e=>document.activeElement===e),true);
            }
            await send();
          }
          assert.equal(calls[0].raw,calls[1].raw);
          if(scenario==='explicit_edit') assert.notEqual(calls[0].key,calls[2].key);
          else for(const call of calls) {
            assert.equal(call.raw,calls[0].raw); assert.equal(call.key,calls[0].key);
            assert.equal(call.submitted,calls[0].submitted);
          }
        }
        assert.equal(ledger.size,scenario==='explicit_edit'?2:1);
        assert.match(await form.locator('.form-status.success').textContent(),scenario==='explicit_edit'?/482732/:/482731/);
        assert.equal(await edit.isVisible(),false);
        results.push({name,status:'PASS'});
      } catch(error) {results.push({name,status:'FAIL',reason:error.message}); console.error(name+': '+error.message);}
      finally {await context.close();}
    }
  } finally {await browser.close();}
  console.log(JSON.stringify({evidence:'browser + mock receipt ledger; no network',results},null,2));
  if(results.some(x=>x.status==='FAIL')) process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
