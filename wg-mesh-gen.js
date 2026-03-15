const fs = require('fs');
const { execSync } = require('child_process');

// ==========================================
// GLOBAL CONFIGURATION / CONSTANTS
// ==========================================
const GLOBAL_FILE = 'global.json';
const DEFAULT_DAWN_PORT = 1026;
const DEFAULT_WG_PORT = 51820;
const DEFAULT_WG_MTU = 1440;
const WG_TUNNEL_PREFIX = '192.168.76.'; 
const WG_INTERFACE_MASK = 24;           // Local interface subnet mask (/24)
const WG_INTERFACE_NAME = 'wgDawn';
// ==========================================

const args = process.argv.slice(2);
const command = args[0];

function checkWgInstalled() {
    try {
        execSync('wg --version', { stdio: 'ignore' });
    } catch (e) {
        console.error('❌ Error: "wireguard-tools" is not installed. Cannot execute "wg" command to generate keys.');
        console.error('👉 Hint: Please install it first (e.g., "apt install wireguard-tools").');
        process.exit(1);
    }
}

if (command === 'config') {
    const hostnames = args.slice(1);

    if (hostnames.length === 0) {
        if (!fs.existsSync(GLOBAL_FILE)) {
            console.error(`❌ Error: ${GLOBAL_FILE} does not exist in the current directory.`);
            console.log(`👉 Hint: Use a command like 'node wg-mesh-gen.js config ap1 ap2 ap3' to generate a base template.`);
            process.exit(1);
        } else {
            console.log(`✅ ${GLOBAL_FILE} already exists. If you have filled in the required fields, run 'node wg-mesh-gen.js generate'.`);
        }
    } else {
        if (fs.existsSync(GLOBAL_FILE)) {
            console.warn(`⚠️ Warning: ${GLOBAL_FILE} already exists. It will not be overwritten. Delete it manually if you want to regenerate.`);
        } else {
            const nodes = hostnames.map((host, index) => ({
                hostname: host,
                lan_ip: "",               // [REQUIRED] User must fill this manually
                dawn_port: DEFAULT_DAWN_PORT,
                wg_port: DEFAULT_WG_PORT, 
                wg_tunnel_ip: `${WG_TUNNEL_PREFIX}${index + 1}`, 
                wg_privkey: "",           
                wg_pubkey: ""             
            }));
            fs.writeFileSync(GLOBAL_FILE, JSON.stringify({ nodes }, null, 4));
            console.log(`✅ Successfully generated base template: ${GLOBAL_FILE}.`);
            console.log(`👉 Next Step: Open ${GLOBAL_FILE} and fill in the 'lan_ip' for each node.`);
        }
    }

} else if (command === 'generate') {
    if (!fs.existsSync(GLOBAL_FILE)) {
        console.error(`❌ Error: Cannot find ${GLOBAL_FILE}. Please run the 'config' command to generate and configure it first.`);
        process.exit(1);
    }

    let globalData;
    try {
        globalData = JSON.parse(fs.readFileSync(GLOBAL_FILE, 'utf8'));
    } catch (e) {
        console.error(`❌ Error: Failed to parse ${GLOBAL_FILE}. Please check if the JSON format is valid.`);
        process.exit(1);
    }

    let isModified = false;
    checkWgInstalled();

    globalData.nodes.forEach((node, index) => {
        if (!node.hostname || !node.lan_ip || !node.dawn_port) {
            console.error(`❌ Error: Node [${node.hostname || 'Unnamed'}] is missing required fields (hostname, lan_ip, or dawn_port)! Please update ${GLOBAL_FILE}.`);
            process.exit(1);
        }

        if (!node.wg_port) {
            node.wg_port = DEFAULT_WG_PORT;
            isModified = true;
        }

        if (!node.wg_tunnel_ip) {
            node.wg_tunnel_ip = `${WG_TUNNEL_PREFIX}${index + 1}`;
            isModified = true;
        }

        if (!node.wg_privkey || !node.wg_pubkey) {
            console.log(`Generating WireGuard keys for node: ${node.hostname}...`);
            const privKey = execSync('wg genkey').toString().trim();
            const pubKey = execSync(`echo "${privKey}" | wg pubkey`).toString().trim();
            
            node.wg_privkey = privKey;
            node.wg_pubkey = pubKey;
            isModified = true;
        }
    });

    if (isModified) {
        fs.writeFileSync(GLOBAL_FILE, JSON.stringify(globalData, null, 4));
        console.log(`✅ Missing fields in ${GLOBAL_FILE} have been auto-generated and saved.`);
    }

    globalData.nodes.forEach(currentNode => {
        const configFileName = `${currentNode.hostname}.json`;
        
        const peers = globalData.nodes.filter(n => n.hostname !== currentNode.hostname);

        const configJson = {
            interfaces: [
                {
                    type: "wireguard",
                    private_key: currentNode.wg_privkey,
                    port: currentNode.wg_port,
                    mtu: DEFAULT_WG_MTU,
                    nohostroute: false,
                    fwmark: "",
                    ip6prefix: [],
                    addresses: [
                        {
                            proto: "static",
                            family: "ipv4",
                            address: currentNode.wg_tunnel_ip,
                            mask: WG_INTERFACE_MASK // Sets local interface subnet mask to 24
                        }
                    ],
                    name: WG_INTERFACE_NAME,
                    disabled: false,
                    network: ""
                }
            ],
            wireguard_peers: peers.map(peer => ({
                interface: WG_INTERFACE_NAME,
                public_key: peer.wg_pubkey,
                allowed_ips: [
                    `${peer.wg_tunnel_ip}/32` // Forces peer routing to /32
                ],
                endpoint_host: peer.lan_ip,
                endpoint_port: peer.wg_port,
                preshared_key: "",
                persistent_keepalive: 0,
                route_allowed_ips: true
            })),
            "dawn-mdns-stub": peers.map(peer => ({
                config_name: "peer",
                config_value: peer.hostname,
                ipv4: peer.wg_tunnel_ip,
                port: String(peer.dawn_port)
            }))
        };

        fs.writeFileSync(configFileName, JSON.stringify(configJson, null, 4));
        console.log(`📄 Generated node configuration: ${configFileName}`);
    });

    console.log(`\n🎉 All configurations generated successfully!`);

} else {
    console.log(`Usage:`);
    console.log(`  node wg-mesh-gen.js config                - Check if ${GLOBAL_FILE} exists`);
    console.log(`  node wg-mesh-gen.js config <ap1> <ap2>... - Initialize ${GLOBAL_FILE} template`);
    console.log(`  node wg-mesh-gen.js generate              - Read ${GLOBAL_FILE} and generate final configs`);
}
