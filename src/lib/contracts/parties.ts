import { isValidCpf, onlyDigits } from "./validation";

export const MAX_CONTRACTORS = 20;
export type ContractorInput = { fullName: string; cpf: string };
export type ContractParty = { clientId: string; fullName: string; cpf: string | null };
type LinkedContract = {
  client_id: string; client_name: string; client_cpf: string | null; contractors?: ContractParty[];
};

export function getContractParties(contract: LinkedContract): ContractParty[] {
  return contract.contractors?.length ? contract.contractors :
    [{ clientId: contract.client_id, fullName: contract.client_name, cpf: contract.client_cpf }];
}
export function contractClientLabel(contract: LinkedContract): string {
  return getContractParties(contract).map((party) => party.fullName).join(" / ");
}
export function validateContractors(parties: ContractorInput[]) {
  if (!Array.isArray(parties) || parties.length < 1 || parties.length > MAX_CONTRACTORS)
    throw new Error(`Informe entre 1 e ${MAX_CONTRACTORS} contratantes.`);
  const cpfs = new Set<string>();
  parties.forEach((party, index) => {
    if (!party || typeof party.fullName !== "string" || party.fullName.trim().length < 2 || party.fullName.trim().length > 160)
      throw new Error(`Informe o nome completo do contratante ${index + 1}.`);
    if (typeof party.cpf !== "string" || !isValidCpf(party.cpf)) throw new Error(`Informe um CPF válido para o contratante ${index + 1}.`);
    const cpf = onlyDigits(party.cpf);
    if (cpfs.has(cpf)) throw new Error("O mesmo CPF não pode ser incluído duas vezes no contrato.");
    cpfs.add(cpf);
  });
}
