import assert from "node:assert/strict";
import {test} from "node:test";
import {closingOriginsQuery,parseClosingOrigins} from "../src/lib/reports/closing-filters";
import {closingOriginDocument,type ClosingOriginData} from "../src/lib/reports/closing-origin";

test("origens do fechamento são validadas e não duplicam a seleção",()=>{
  const selected=parseClosingOrigins(new URLSearchParams("origem=Propriedade+Intelectual&origem=Cliente+próprio&origem=Cliente+próprio"));
  assert.deepEqual(selected,["Cliente próprio","Propriedade Intelectual"]);
  assert.deepEqual(parseClosingOrigins(new URLSearchParams(closingOriginsQuery(selected))),selected);
  assert.deepEqual(parseClosingOrigins(new URLSearchParams()),[]);
  assert.throws(()=>parseClosingOrigins(new URLSearchParams("origem=outro")),/origens válidas/);
});

test("recorte apresenta participação retida de cada beneficiário sem afirmar repasse pago",()=>{
  const data:ClosingOriginData={version:2,issued_at:"2026-11-04T12:00:00Z",office_name:"Escritório Teste",lawyer_name:"Advogada Teste",origins:["Tráfego HP"],
    closing:{id:"teste",reference_month:10,reference_year:2026,closed_at:"2026-11-01T03:00:00Z"},
    rows:[{payment_id:"p",contract_id:"c",payment_date:"2026-10-10",client_name:"Cliente Teste",origin:"Tráfego HP",received_amount:500,lawyer_amount:250,third_party_amount:250}],
    recipients:[{contract_id:"c",client_name:"Cliente Teste",origin:"Tráfego HP",name:"Advogada Teste",kind:"lawyer",amount:250},
      {contract_id:"c",client_name:"Cliente Teste",origin:"Tráfego HP",name:"Comercial Teste",kind:"commercial",amount:250}]};
  const report=closingOriginDocument(data,"Gestor Teste");
  assert.deepEqual(report.metrics.map(item=>item.value),["R$ 500,00","R$ 250,00","R$ 250,00","R$ 0,00"]);
  assert.equal(report.sections[0].rows[0][0],"10/10/2026");
  assert.match(report.sections[1].rows[1][1],/Comercial Teste/);
  assert.ok(report.notes.some(note=>note.includes("não comprova pagamento")));
  const empty=closingOriginDocument({...data,rows:[],recipients:[]},"Advogada Teste");
  assert.ok(empty.metrics.every(item=>item.value==="R$ 0,00"));
  assert.equal(empty.sections[0].rows.length,0);
});
