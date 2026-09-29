window.openCustomerReadingEditor = async function(kind, id) {
  const route='/api/admin/customer-readings/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id);
  const auth=()=>'?password='+encodeURIComponent(typeof adminPassword!=='undefined'?adminPassword:'');
  const request=async(method='GET',body,suffix='')=>{
    const res=await fetch(route+suffix+auth(),{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const data=await res.json();if(!res.ok)throw Error(data.error||'Unable to save the reading.');return data;
  };
  let data;
  try{data=await request();}catch(e){alert(e.message);return;}
  const dialog=document.createElement('dialog');
  dialog.setAttribute('aria-labelledby','customer-reading-title');
  dialog.style.cssText='margin:auto;width:min(760px,calc(100% - 24px));max-height:90dvh;overflow:auto;padding:24px;border:1px solid #d5c4df;border-radius:12px;color:#392c44;background:white';
  dialog.innerHTML=`<form><h2 id="customer-reading-title">Save a finished reading</h2><p id="reading-purchase-label"></p><p>This saves the reading to this purchase in the customer’s account. Choose Save &amp; Notify Customer to send an email link, or Save Only to update the account quietly.</p><p id="customer-reading-notify-to"></p><label for="customer-reading-text">Reading text</label><textarea id="customer-reading-text" rows="14" maxlength="250000" style="width:100%;box-sizing:border-box;font-size:16px;padding:12px;margin:8px 0"></textarea><label for="customer-reading-file">Attach a PDF (optional, up to 8 MB)</label><input id="customer-reading-file" type="file" accept="application/pdf,.pdf" style="display:block;margin:10px 0;font-size:16px"><p id="customer-reading-existing"></p><label id="remove-pdf-label" hidden><input id="customer-reading-remove" type="checkbox"> Remove the existing PDF</label><p id="customer-reading-status" role="status" aria-live="polite"></p><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px"><button type="submit" name="delivery" value="notify" class="btn btn-primary">Save &amp; Notify Customer</button><button type="submit" name="delivery" value="save" class="btn btn-secondary">Save Only</button><button type="button" class="btn btn-secondary" id="customer-reading-notify" hidden>Send / Retry Notification</button><button type="button" class="btn btn-secondary" id="customer-reading-close">Close</button></div></form>`;
  document.body.append(dialog);
  const find=id=>dialog.querySelector('#'+id), form=dialog.querySelector('form'), status=find('customer-reading-status');
  find('reading-purchase-label').textContent=data.title+' · '+data.recipient+' · Order '+id;
  find('customer-reading-text').value=data.text;
  find('customer-reading-notify-to').textContent='Notification recipient: '+(data.notificationEmail||'Email unavailable');
  const showPdf=()=>{find('customer-reading-existing').textContent=data.pdfName?'Saved PDF: '+data.pdfName:'No PDF attached.';find('remove-pdf-label').hidden=!data.pdfName;};showPdf();
  let dirty=false,pending=false;
  const notify=async()=>{status.textContent='Sending notification…';const result=await request('POST',{revision:data.revision},'/notify');status.textContent=result.message;find('customer-reading-notify').hidden=true;};
  find('customer-reading-notify').hidden=!data.revision||data.notifiedRevision>=data.revision;
  find('customer-reading-notify').onclick=async()=>{if(pending)return;if(dirty){status.textContent='Save your edits before sending the notification.';return;}pending=true;try{await notify();}catch(e){status.textContent=e.message;}finally{pending=false;}};
  form.addEventListener('input',()=>dirty=true);
  const close=()=>{if(!pending&&(!dirty||confirm('Close without saving these edits?'))){dialog.close();dialog.remove();}};
  find('customer-reading-close').onclick=close;
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  form.onsubmit=async e=>{
    e.preventDefault();if(pending)return;
    pending=true;const buttons=[...form.querySelectorAll('[type=submit]')];buttons.forEach(b=>b.disabled=true);status.textContent='Saving…';
    try{
      const file=find('customer-reading-file').files[0];
      const body={text:find('customer-reading-text').value,revision:data.revision,removePdf:find('customer-reading-remove').checked};
      if(file){
        if(file.size>8*1024*1024)throw Error('Choose a PDF no larger than 8 MB.');
        const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read this PDF.'));reader.readAsDataURL(file);});
        body.pdfBase64=base64;body.pdfName=file.name;
      }
      const result=await request('PUT',body);data.revision=result.revision;
      if(file)data.pdfName=file.name;else if(body.removePdf)data.pdfName=null;
      find('customer-reading-file').value='';find('customer-reading-remove').checked=false;showPdf();dirty=false;status.textContent=result.message;find('customer-reading-notify').hidden=false;
      if(e.submitter?.value==='notify'){try{await notify();}catch(error){status.textContent=error.message;}}
    }catch(err){status.textContent=err.message+' Your edits are still here.';}
    finally{pending=false;buttons.forEach(b=>b.disabled=false);}
  };
  dialog.showModal();
};
