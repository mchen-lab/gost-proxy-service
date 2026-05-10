const proxies = ["bhlh3s45azbf:tn1ol20vf2awogk@65.111.3.196:3129"];
const nodes = [];
for (const line of proxies) {
    const parts = line.split("://");
    let protocol = "http";
    let remaining = line;

    if (parts.length > 1) {
    protocol = parts[0];
    remaining = parts[1];
    }

    let nodeAuth;
    let nodeAddr = remaining;
    if (remaining.includes('@')) {
        const atSplit = remaining.split('@');
        nodeAddr = atSplit[1];
        const authSplit = atSplit[0].split(':');
        nodeAuth = {
            username: authSplit[0],
            password: authSplit[1]
        };
    }

    nodes.push({
    name: `proxy-${nodes.length}`,
    addr: nodeAddr,
    connector: { 
        type: protocol,
        ...(nodeAuth && { auth: nodeAuth })
    }
    });
}
console.log(JSON.stringify(nodes, null, 2));
