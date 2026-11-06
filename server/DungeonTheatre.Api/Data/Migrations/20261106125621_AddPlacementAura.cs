using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DungeonTheatre.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPlacementAura : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AuraColor",
                table: "Placements",
                type: "TEXT",
                nullable: false,
                defaultValue: "#e0b341");

            migrationBuilder.AddColumn<int>(
                name: "AuraRadiusFeet",
                table: "Placements",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AuraColor",
                table: "Placements");

            migrationBuilder.DropColumn(
                name: "AuraRadiusFeet",
                table: "Placements");
        }
    }
}
